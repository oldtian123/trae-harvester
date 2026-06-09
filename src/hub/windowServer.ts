// ============================================================
// Trae Harvester — 窗口侧 HTTP Server (Window-Side HTTP Server)
// ============================================================
// 每个窗口点击「启动 MCP」后，在本地启动一个小型 HTTP server，
// 监听动态分配的端口（37651-37700），等待 Hub 扫描注册。
//
// Hub 定期扫描这些端口，发现窗口后通过 HTTP 调用工具。
// 远程窗口的端口会被 VS Code 自动转发到本地，Hub 在本地即可扫到。
//
// ⚠️ 本文件运行在 VS Code 扩展宿主内，可以 import vscode。

import * as vscode from 'vscode';
import express from 'express';
import { dispatchToolCall } from './toolHandlers';
import { getLogger } from '../utils/logger';

let server: any = null;
let myPort: number | null = null;
let currentStatus: 'IDLE' | 'RUNNING' | 'COMPLETED' = 'IDLE';
let currentIdentifiers = {
    repo_id: undefined as string | undefined,
    branch: undefined as string | undefined,
    model_id: undefined as string | undefined,
    prompt_id: undefined as string | undefined,
};

const PORT_RANGE_START = 37651;
const PORT_RANGE_END = 37700;

function log(msg: string): void {
    getLogger().info('WindowServer', msg);
}

/**
 * 启动窗口侧 HTTP server，动态分配端口。
 * 返回分配到的端口号，失败返回 null。
 */
export async function startWindowServer(context: vscode.ExtensionContext): Promise<number | null> {
    if (server) {
        log('Server already running on port ' + myPort);
        return myPort;
    }

    const app = express();
    app.use(express.json());

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const allowExecution = config.get<boolean>('mcpAllowExecution', true);

    // ---- Hub 扫描端点：返回窗口基本信息 ----
    app.get('/ping', (_req, res) => {
        res.json({
            ok: true,
            sessionId: String(myPort),
            workspace: workspaceFolder,
            pid: process.pid,
            status: currentStatus,
            repo_id: currentIdentifiers.repo_id,
            branch: currentIdentifiers.branch,
            model_id: currentIdentifiers.model_id,
            prompt_id: currentIdentifiers.prompt_id,
            allowExecution,
            remoteName: vscode.env.remoteName || null,
        });
    });

    // ---- Hub 反向调用工具执行 ----
    app.post('/execute_tool', async (req, res) => {
        const { tool, args } = req.body;
        if (!tool) {
            res.status(400).json({ error: 'Missing tool parameter' });
            return;
        }
        try {
            log(`Executing tool: ${tool}`);
            const result = await dispatchToolCall(tool, args || {});
            res.json(result);
        } catch (err: any) {
            log(`Tool execution error: ${err?.message}`);
            res.status(500).json({ error: err?.message || String(err) });
        }
    });

    // ---- 标识/状态更新端点（供 testRunner 调用） ----
    app.post('/update_session', (req, res) => {
        const { status, repo_id, branch, model_id, prompt_id } = req.body;
        if (status) currentStatus = status;
        if (repo_id !== undefined) currentIdentifiers.repo_id = repo_id;
        if (branch !== undefined) currentIdentifiers.branch = branch;
        if (model_id !== undefined) currentIdentifiers.model_id = model_id;
        if (prompt_id !== undefined) currentIdentifiers.prompt_id = prompt_id;
        res.json({ ok: true });
    });

    // ---- 确定性端口分配（基于 PID，避免竞态） ----
    const isRemote = !!vscode.env.remoteName;
    const host = isRemote ? '0.0.0.0' : '127.0.0.1';

    // 根据 PID 计算唯一端口（范围 37651-37700，50个端口）
    const pidBasedPort = PORT_RANGE_START + (process.pid % 50);
    log(`PID: ${process.pid}, calculated port: ${pidBasedPort} (remote: ${isRemote})`);

    return new Promise((resolve) => {
        const tryPort = (port: number, retries: number = 0) => {
            if (retries > 5) {
                log(`Failed to bind after ${retries} retries`);
                vscode.window.showErrorMessage('❌ MCP Server 启动失败：端口冲突');
                resolve(null);
                return;
            }

            log(`Attempt ${retries + 1}: Trying to bind on ${host}:${port}`);

            const s = app.listen(port, host, () => {
                server = s;
                myPort = port;
                log(`✅ Window server started on ${host}:${port}`);
                resolve(port);
            });

            s.on('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    // 端口被占用（容器内或本地），尝试下一个
                    log(`Port ${port} in use, trying ${port + 1}...`);
                    const nextPort = port + 1 > PORT_RANGE_END ? PORT_RANGE_START : port + 1;
                    tryPort(nextPort, retries + 1);
                } else {
                    log(`Server error: ${err.message}`);
                    vscode.window.showErrorMessage(`❌ MCP Server 启动失败: ${err.message}`);
                    resolve(null);
                }
            });
        };

        tryPort(pidBasedPort);
    });
}

/**
 * 停止窗口侧 HTTP server。
 */
export function stopWindowServer(): void {
    if (server) {
        server.close();
        server = null;
        myPort = null;
        log('Window server stopped');
    }
}

/**
 * 查询服务器是否在运行。
 */
export function isWindowServerRunning(): boolean {
    return server !== null && myPort !== null;
}

/**
 * 获取当前监听的端口。
 */
export function getWindowServerPort(): number | null {
    return myPort;
}

/**
 * 推送会话更新（本地调用，不经过网络）。
 */
export function pushSessionUpdate(patch: {
    status?: 'IDLE' | 'RUNNING' | 'COMPLETED';
    repo_id?: string;
    branch?: string;
    model_id?: string;
    prompt_id?: string;
}): void {
    if (patch.status) currentStatus = patch.status;
    if (patch.repo_id !== undefined) currentIdentifiers.repo_id = patch.repo_id;
    if (patch.branch !== undefined) currentIdentifiers.branch = patch.branch;
    if (patch.model_id !== undefined) currentIdentifiers.model_id = patch.model_id;
    if (patch.prompt_id !== undefined) currentIdentifiers.prompt_id = patch.prompt_id;
}
