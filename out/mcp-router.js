#!/usr/bin/env node

// ============================================================
// Trae Harvester — 聚合路由器 (Aggregator Router)
// ============================================================
// 以 stdio MCP 协议运行，扫描 ~/.trae-harvester-registry/ 目录
// 发现所有活跃的 VS Code 窗口，并代理请求到指定窗口。
// 请求时自动从注册文件中读取 auth_token 进行鉴权。

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REGISTRY_DIR = path.join(os.homedir(), '.trae-harvester-registry');

// --- Helper Functions ---

function getRegistry() {
    const result = {};
    try {
        if (!fs.existsSync(REGISTRY_DIR)) {
            return result;
        }
        const files = fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'));
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(REGISTRY_DIR, file);
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                const entry = JSON.parse(data);

                // 心跳超过 120 秒认为已死（给 Router 更宽松的容忍度）
                if (now - entry.last_heartbeat > 120000) {
                    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
                    continue;
                }

                const port = path.basename(file, '.json');
                result[port] = entry;
            } catch (e) {
                // 单个文件读取失败不影响其他
            }
        }
    } catch (e) {
        // 目录不存在或读取失败
    }
    return result;
}

function fetchFromPort(port, method, params, authToken) {
    return new Promise((resolve, reject) => {
        const payload = JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: method,
            params: params
        });

        const headers = {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
        };
        // 自动注入 Bearer Token 鉴权
        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        const req = http.request({
            hostname: '127.0.0.1',
            port: port,
            path: '/mcp',
            method: 'POST',
            headers: headers,
            timeout: 10000
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 401) {
                    reject(new Error('Authentication failed (401): the auth token may be stale. Try restarting the VS Code window.'));
                    return;
                }
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error("Invalid JSON response from worker node"));
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timed out'));
        });
        req.write(payload);
        req.end();
    });
}

// --- MCP Server Implementation ---

function sendResponse(id, result, error = null) {
    const response = {
        jsonrpc: "2.0",
        id: id
    };
    if (error) {
        response.error = error;
    } else {
        response.result = result;
    }
    process.stdout.write(JSON.stringify(response) + "\n");
}

function handleInitialize(id) {
    sendResponse(id, {
        protocolVersion: "2024-11-05",
        capabilities: {},
        serverInfo: {
            name: "TraeHarvesterAggregatorRouter",
            version: "2.0.0"
        }
    });
}

function handleToolsList(id) {
    sendResponse(id, {
        tools: [
            {
                name: "trea_harvester_list_windows",
                description: "List all active VS Code windows running Trae Harvester, showing their session_id (port), model identifier, prompt identifier, and test completion status.",
                inputSchema: {
                    type: "object",
                    properties: {}
                }
            },
            {
                name: "trea_harvester_get_evidence",
                description: "Retrieve the evaluation evidence (Git Patch and test results) from a specific COMPLETED VS Code window by its session_id.",
                inputSchema: {
                    type: "object",
                    properties: {
                        session_id: {
                            type: "string",
                            description: "The session_id (port) of the target VS Code window."
                        }
                    },
                    required: ["session_id"]
                }
            }
        ]
    });
}

async function handleToolsCall(id, params) {
    const { name, arguments: args } = params;

    if (name === "trea_harvester_list_windows") {
        const registry = getRegistry();
        const windows = [];
        for (const port in registry) {
            const entry = registry[port];
            windows.push({
                session_id: port,
                model: entry.model_id || "None",
                prompt: entry.prompt_id || "None",
                status: entry.status || "IDLE",
                workspace: entry.workspace
            });
        }
        sendResponse(id, {
            content: [{ type: "text", text: JSON.stringify(windows, null, 2) }]
        });
        return;
    }

    if (name === "trea_harvester_get_evidence") {
        const sessionId = args.session_id;
        if (!sessionId) {
            sendResponse(id, null, { code: -32602, message: "Missing session_id parameter" });
            return;
        }

        const registry = getRegistry();
        if (!registry[sessionId]) {
            sendResponse(id, {
                content: [{ type: "text", text: `Error: Session ${sessionId} not found or inactive.` }],
                isError: true
            });
            return;
        }

        // 从注册文件中读取该窗口的 auth_token
        const targetEntry = registry[sessionId];
        const authToken = targetEntry.auth_token || null;

        try {
            // 代理请求到目标窗口，自动携带 Bearer Token
            const response = await fetchFromPort(parseInt(sessionId), "tools/call", {
                name: "trea_harvester_get_evaluation_evidence",
                arguments: {}
            }, authToken);
            
            if (response.error) {
                sendResponse(id, {
                    content: [{ type: "text", text: `Worker error: ${response.error.message}` }],
                    isError: true
                });
            } else {
                sendResponse(id, response.result);
            }
        } catch (e) {
            sendResponse(id, {
                content: [{ type: "text", text: `Failed to communicate with session ${sessionId}: ${e.message}` }],
                isError: true
            });
        }
        return;
    }

    sendResponse(id, null, { code: -32601, message: "Method not found" });
}

// --- Stdio Message Loop ---

let buffer = '';
process.stdin.on('data', async (chunk) => {
    buffer += chunk.toString();
    let boundary = buffer.indexOf('\n');
    while (boundary !== -1) {
        const line = buffer.substring(0, boundary).trim();
        buffer = buffer.substring(boundary + 1);
        boundary = buffer.indexOf('\n');

        if (!line) continue;

        try {
            const message = JSON.parse(line);
            
            if (message.method === "initialize") {
                handleInitialize(message.id);
            } else if (message.method === "tools/list") {
                handleToolsList(message.id);
            } else if (message.method === "tools/call") {
                await handleToolsCall(message.id, message.params);
            } else if (message.id) {
                // Ignore other methods but return empty success to satisfy protocol
                sendResponse(message.id, {});
            }
        } catch (e) {
            // Invalid message
        }
    }
});
