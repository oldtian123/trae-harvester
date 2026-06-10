"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWindowServer = startWindowServer;
exports.stopWindowServer = stopWindowServer;
exports.isWindowServerRunning = isWindowServerRunning;
exports.getWindowServerPort = getWindowServerPort;
exports.pushSessionUpdate = pushSessionUpdate;
const vscode = __importStar(require("vscode"));
const express_1 = __importDefault(require("express"));
const toolHandlers_1 = require("./toolHandlers");
const logger_1 = require("../utils/logger");
let server = null;
let myPort = null;
let currentStatus = 'IDLE';
let currentIdentifiers = {
    repo_id: undefined,
    branch: undefined,
    model_id: undefined,
    prompt_id: undefined,
};
const PORT_RANGE_START = 37651;
const PORT_RANGE_END = 37700;
function log(msg) {
    (0, logger_1.getLogger)().info('WindowServer', msg);
}
/**
 * 启动窗口侧 HTTP server，动态分配端口。
 * 返回分配到的端口号，失败返回 null。
 */
async function startWindowServer(context) {
    if (server) {
        log('Server already running on port ' + myPort);
        return myPort;
    }
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const allowExecution = config.get('mcpAllowExecution', true);
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
            const result = await (0, toolHandlers_1.dispatchToolCall)(tool, args || {});
            res.json(result);
        }
        catch (err) {
            log(`Tool execution error: ${err?.message}`);
            res.status(500).json({ error: err?.message || String(err) });
        }
    });
    // ---- 标识/状态更新端点（供 testRunner 调用） ----
    app.post('/update_session', (req, res) => {
        const { status, repo_id, branch, model_id, prompt_id } = req.body;
        if (status)
            currentStatus = status;
        if (repo_id !== undefined)
            currentIdentifiers.repo_id = repo_id;
        if (branch !== undefined)
            currentIdentifiers.branch = branch;
        if (model_id !== undefined)
            currentIdentifiers.model_id = model_id;
        if (prompt_id !== undefined)
            currentIdentifiers.prompt_id = prompt_id;
        res.json({ ok: true });
    });
    // ---- 确定性端口分配（基于 PID，避免竞态） ----
    const isRemote = !!vscode.env.remoteName;
    const host = isRemote ? '0.0.0.0' : '127.0.0.1';
    // 根据 PID 计算唯一端口（范围 37651-37700，50个端口）
    const pidBasedPort = PORT_RANGE_START + (process.pid % 50);
    log(`PID: ${process.pid}, calculated port: ${pidBasedPort} (remote: ${isRemote})`);
    return new Promise((resolve) => {
        const tryPort = (port, retries = 0) => {
            if (retries > 50) {
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
                // 自动更新 repo/branch 信息
                autoUpdateRepoAndBranch().catch(err => {
                    log(`Failed to auto-update repo/branch: ${err.message}`);
                });
                resolve(port);
            });
            s.on('error', (err) => {
                if (err.code === 'EADDRINUSE') {
                    // 端口被占用（容器内或本地），尝试下一个
                    log(`Port ${port} in use, trying ${port + 1}...`);
                    const nextPort = port + 1 > PORT_RANGE_END ? PORT_RANGE_START : port + 1;
                    tryPort(nextPort, retries + 1);
                }
                else {
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
function stopWindowServer() {
    if (server) {
        try {
            if (typeof server.closeAllConnections === 'function') {
                server.closeAllConnections();
            }
            server.close();
        }
        catch (err) {
            log(`Error closing server: ${err.message}`);
        }
        server = null;
        myPort = null;
        log('Window server stopped');
    }
}
/**
 * 查询服务器是否在运行。
 */
function isWindowServerRunning() {
    return server !== null && myPort !== null;
}
/**
 * 获取当前监听的端口。
 */
function getWindowServerPort() {
    return myPort;
}
/**
 * 自动更新 repo 和 branch 信息到 Hub
 */
async function autoUpdateRepoAndBranch() {
    try {
        const { getCurrentBranch } = require('../commands/gitPatch');
        const branch = await getCurrentBranch();
        if (branch && branch !== 'unknown') {
            currentIdentifiers.branch = branch;
            log(`Auto-updated branch: ${branch}`);
        }
    }
    catch (e) {
        log(`Could not detect branch: ${e.message}`);
    }
}
/**
 * 推送会话更新（本地调用，不经过网络）。
 */
function pushSessionUpdate(patch) {
    if (patch.status)
        currentStatus = patch.status;
    if (patch.repo_id !== undefined)
        currentIdentifiers.repo_id = patch.repo_id;
    if (patch.branch !== undefined)
        currentIdentifiers.branch = patch.branch;
    if (patch.model_id !== undefined)
        currentIdentifiers.model_id = patch.model_id;
    if (patch.prompt_id !== undefined)
        currentIdentifiers.prompt_id = patch.prompt_id;
}
//# sourceMappingURL=windowServer.js.map