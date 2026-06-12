// ============================================================
// Trae Harvester — Hub 守护进程 (Daemon with Port Scanning)
// ============================================================
// 单一常驻进程，手动/大模型启动。职责：
//   - 定期扫描端口范围 (37651-37700)，发现并注册窗口
//   - /mcp  : 对大模型暴露聚合 MCP 工具 (Bearer 鉴权, stateless POST)
//   - /health, /windows, / : 健康检查、窗口列表、Web 前端
// 工具调用通过 HTTP POST 转发到目标窗口的 /execute_tool。
//
// ⚠️ 独立运行于 VS Code 扩展宿主之外，【绝对不能 import 'vscode'】。
// 由 `node out/hub/daemon.js` 手动启动，或 bridge/大模型首次调用时自动拉起。

import * as http from 'http';
import * as fs from 'fs';
import * as crypto from 'crypto';
import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import {
    DEFAULT_HUB_PORT, HUB_INFO_FILE, MCP_PATH,
    HubInfo, WindowSession, ToolResult, WindowToolName,
} from './protocol';
import { createHubMcpServer } from './mcpTools';

// ============================================================
// 窗口注册表（通过端口扫描维护）
// ============================================================

const SCAN_RANGE = { start: 37651, end: 37700 };
const SCAN_INTERVAL = 5000; // 5秒扫描一次
const WINDOW_TIMEOUT = 15000; // 15秒未响应视为离线

interface WindowEntry {
    session: WindowSession;
    lastSeen: number;
    port: number;
    /** 窗口的鉴权令牌（从 /ping 获取，调用 /execute_tool 时回传） */
    token: string;
}

class HubRegistry {
    private windows = new Map<string, WindowEntry>();

    async scanAndRegister() {
        const now = Date.now();
        const discovered = new Set<string>();

        // 扫描端口范围
        for (let port = SCAN_RANGE.start; port <= SCAN_RANGE.end; port++) {
            try {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 1000);

                const res = await fetch(`http://127.0.0.1:${port}/ping`, {
                    signal: controller.signal,
                });
                clearTimeout(timeoutId);

                if (res.ok) {
                    const data: any = await res.json();
                    const sessionId = String(port); // 用端口作为 sessionId
                    discovered.add(sessionId);

                    const session: WindowSession = {
                        sessionId,
                        workspace: data.workspace || 'unknown',
                        pid: data.pid || 0,
                        status: data.status || 'IDLE',
                        repo_id: data.repo_id,
                        branch: data.branch,
                        model_id: data.model_id,
                        prompt_id: data.prompt_id,
                        allowExecution: data.allowExecution !== false,
                    };

                    if (!this.windows.has(sessionId)) {
                        log(`✅ Discovered new window: ${sessionId} (${session.workspace})`);
                    }

                    this.windows.set(sessionId, { session, lastSeen: now, port, token: data.token || '' });
                }
            } catch {
                // 端口无响应，跳过
            }
        }

        // 清理超时窗口
        for (const [sessionId, entry] of this.windows.entries()) {
            if (!discovered.has(sessionId) && now - entry.lastSeen > WINDOW_TIMEOUT) {
                log(`❌ Window timed out: ${sessionId}`);
                this.windows.delete(sessionId);
            }
        }
    }

    startScanning() {
        log('🔍 Starting port scanner...');
        this.scanAndRegister(); // 立即扫一次
        setInterval(() => this.scanAndRegister(), SCAN_INTERVAL);
    }

    list(): WindowSession[] {
        return [...this.windows.values()].map(e => e.session);
    }

    get(sessionId: string): WindowEntry | undefined {
        return this.windows.get(sessionId);
    }

    async callWindow(sessionId: string, tool: WindowToolName, args: Record<string, unknown> = {}): Promise<ToolResult> {
        const entry = this.windows.get(sessionId);
        if (!entry) {
            throw new Error(`Window ${sessionId} not found`);
        }

        try {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' };
            if (entry.token) {
                headers['Authorization'] = `Bearer ${entry.token}`;
            }
            const res = await fetch(`http://127.0.0.1:${entry.port}/execute_tool`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ tool, args }),
                signal: AbortSignal.timeout(120000), // 2 分钟超时
            });

            if (!res.ok) {
                throw new Error(`Window returned ${res.status}`);
            }

            const result: any = await res.json();
            return result as ToolResult;
        } catch (err: any) {
            throw new Error(`Failed to reach window ${sessionId}: ${err.message}`);
        }
    }
}

const registry = new HubRegistry();

// ============================================================
// Stateless HTTP Transport（兼容 Codex 直连 POST）
// ============================================================
class StatelessHttpTransport implements Transport {
    onclose?: () => void;
    onerror?: (error: Error) => void;
    onmessage?: (message: JSONRPCMessage) => void;
    private pending = new Map<number | string, (msg: JSONRPCMessage) => void>();

    async start(): Promise<void> {}
    async close(): Promise<void> {}

    async send(message: JSONRPCMessage): Promise<void> {
        if ('id' in message && message.id !== undefined) {
            const resolve = this.pending.get(message.id);
            if (resolve) {
                resolve(message);
                this.pending.delete(message.id);
            }
        }
    }

    public handleHttpRequest(reqMessage: JSONRPCMessage): Promise<JSONRPCMessage | null> {
        return new Promise((resolve) => {
            // JSON-RPC 通知（无 id）不会产生响应，必须立即 resolve，
            // 否则 POST 会一直挂起到 socket 超时，并串行阻塞 bridge 的后续请求。
            const hasId = 'id' in reqMessage && reqMessage.id !== undefined && reqMessage.id !== null;

            if (hasId) {
                this.pending.set(reqMessage.id!, resolve);
            }

            if (this.onmessage) {
                this.onmessage(reqMessage);
            } else {
                if (hasId) {
                    resolve({ jsonrpc: '2.0', id: (reqMessage as any).id, error: { code: -32000, message: 'Transport not ready' } } as JSONRPCMessage);
                } else {
                    resolve(null);
                }
                return;
            }

            // 通知已交给 onmessage 处理，但没有响应可回，立即结束
            if (!hasId) {
                resolve(null);
            }
        });
    }
}

// ============================================================
// 启动
// ============================================================

const AUTH_TOKEN = crypto.randomBytes(32).toString('hex');
const PORT = Number(process.env.TRAE_HUB_PORT) || DEFAULT_HUB_PORT;

function log(msg: string): void {
    console.log(`[Hub ${new Date().toISOString()}] ${msg}`);
}

const mcpDeps = {
    listWindows: () => registry.list(),
    callWindow: (sessionId: string, tool: WindowToolName, args?: Record<string, unknown>) => registry.callWindow(sessionId, tool, args),
};

const app = express();

// ---- 健康检查 & 窗口列表 & Token（无需鉴权，放在最前面） ----
app.get('/health', (_req, res) => {
    res.json({ ok: true, pid: process.pid, windows: registry.list().length, startedAt: STARTED_AT });
});
app.get('/windows', (_req, res) => {
    res.json(registry.list());
});
app.get('/token', (_req, res) => {
    res.json({ token: AUTH_TOKEN });
});

// ---- Web 前端：实时窗口状态页面 ----
app.get('/', (_req, res) => {
    const windows = registry.list();
    const html = `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Trae Harvester Hub - 实时状态</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #1e1e1e; color: #d4d4d4; padding: 20px; }
        .container { max-width: 1400px; margin: 0 auto; }
        h1 { color: #4ec9b0; margin-bottom: 10px; font-size: 28px; }
        .meta { color: #858585; margin-bottom: 30px; font-size: 14px; }
        .meta span { margin-right: 20px; }
        table { width: 100%; border-collapse: collapse; background: #252526; border-radius: 8px; overflow: hidden; }
        th { background: #2d2d30; padding: 12px; text-align: left; font-weight: 600; color: #4ec9b0; border-bottom: 2px solid #3e3e42; }
        td { padding: 12px; border-bottom: 1px solid #3e3e42; }
        tr:last-child td { border-bottom: none; }
        tr:hover { background: #2a2d2e; }
        .status { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
        .status.IDLE { background: #3a3a3a; color: #858585; }
        .status.RUNNING { background: #5a3e1b; color: #ce9178; }
        .status.COMPLETED { background: #1e4620; color: #4ec9b0; }
        .empty { text-align: center; padding: 60px 20px; color: #858585; font-size: 16px; }
        .refresh { color: #4ec9b0; font-size: 12px; margin-top: 20px; }
        code { background: #1e1e1e; padding: 2px 6px; border-radius: 3px; color: #ce9178; }
    </style>
    <script>
        // 每 3 秒自动刷新
        setTimeout(() => location.reload(), 3000);
    </script>
</head>
<body>
    <div class="container">
        <h1>🚀 Trae Harvester Hub - 实时多窗口状态</h1>
        <div class="meta">
            <span>🕐 ${new Date().toLocaleString('zh-CN', { hour12: false })}</span>
            <span>🔌 端口: <code>${PORT}</code></span>
            <span>📊 活跃窗口: <strong>${windows.length}</strong></span>
            <span>🆔 PID: <code>${process.pid}</code></span>
        </div>
        ${windows.length === 0 ? `
        <div class="empty">
            <p>暂无活跃窗口</p>
            <p style="margin-top: 10px; font-size: 14px;">请在 VS Code 中打开工作区并点击「启动 MCP」按钮</p>
        </div>
        ` : `
        <table>
            <thead>
                <tr>
                    <th>PORT</th>
                    <th>PID</th>
                    <th>REPO</th>
                    <th>BRANCH</th>
                    <th>MODEL#</th>
                    <th>CONTAINER</th>
                    <th>PROMPT</th>
                    <th>STATUS</th>
                    <th>WORKSPACE</th>
                </tr>
            </thead>
            <tbody>
                ${windows.map(w => `
                <tr>
                    <td><code>${w.sessionId}</code></td>
                    <td>${w.pid}</td>
                    <td>${w.repo_id || '-'}</td>
                    <td>${w.branch || '-'}</td>
                    <td>${w.model_id || '-'}</td>
                    <td><code>${/^\d+$/.test(String(w.model_id || '')) ? 'm' + String(w.model_id).padStart(2, '0') : '-'}</code></td>
                    <td>${w.prompt_id || '-'}</td>
                    <td><span class="status ${w.status}">${w.status}</span></td>
                    <td title="${w.workspace}">${w.workspace.split(/[/\\]/).pop() || w.workspace}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>
        `}
        <div class="refresh">⟳ 页面每 3 秒自动刷新 | 扫描范围: ${SCAN_RANGE.start}-${SCAN_RANGE.end}</div>
    </div>
</body>
</html>`;
    res.send(html);
});

// ---- /mcp Bearer 鉴权（放在 MCP 路由之前，但在其他路由之后） ----
app.use(MCP_PATH, (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    if (authHeader === `Bearer ${AUTH_TOKEN}`) {
        next();
        return;
    }
    res.status(401).json({ error: 'Unauthorized. Missing or invalid Bearer token.' });
});

// 全局 stateless transport（直连 POST）
const statelessTransport = new StatelessHttpTransport();
const mcpServer = createHubMcpServer(mcpDeps);
mcpServer.connect(statelessTransport);

app.post(MCP_PATH, async (req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
        try {
            const message = JSON.parse(body);
            const response = await statelessTransport.handleHttpRequest(message);
            if (response === null) {
                // 通知类消息无响应体
                res.status(202).end();
            } else {
                res.json(response);
            }
        } catch {
            res.status(400).send('Invalid JSON');
        }
    });
});

const server = http.createServer(app);

// ============================================================
// 监听（单例：端口被占用即认为已有 Hub，直接退出）
// ============================================================
let STARTED_AT = 0;

server.listen(PORT, '127.0.0.1', () => {
    STARTED_AT = Date.now();
    const info: HubInfo = { port: PORT, token: AUTH_TOKEN, pid: process.pid, startedAt: STARTED_AT };
    try {
        fs.writeFileSync(HUB_INFO_FILE, JSON.stringify(info, null, 2), 'utf-8');
    } catch (e: any) {
        log(`Failed to write hub info file: ${e?.message}`);
    }
    log(`✅ Hub listening on http://127.0.0.1:${PORT}`);
    log(`   Web UI: http://127.0.0.1:${PORT}`);
    log(`   MCP endpoint: http://127.0.0.1:${PORT}${MCP_PATH}`);

    // 启动端口扫描
    registry.startScanning();
});

server.on('error', (err: any) => {
    if (err.code === 'EADDRINUSE') {
        log(`Port ${PORT} already in use — another Hub is running. Exiting.`);
        process.exit(0);
    } else {
        log(`Hub server error: ${err?.message}`);
        process.exit(1);
    }
});
