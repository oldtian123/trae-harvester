import * as vscode from 'vscode';
import express from 'express';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import * as fs from 'fs';
import { getLogger } from '../utils/logger';
import { registerInstance, unregisterInstance, getCurrentAuthToken } from '../utils/registry';
import { 
    getCurrentPlan, 
    getStepResults, 
    addStepToPlan, 
    addCheckItemToPlan 
} from '../commands/testRunner';

import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

let serverInstance: any = null;
/** 当前实例的鉴权令牌 */
let currentAuthToken: string | null = null;

// ==========================================
// Stateless HTTP Transport (For Codex direct POST)
// ==========================================
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

    public async handleHttpRequest(reqMessage: JSONRPCMessage): Promise<JSONRPCMessage> {
        return new Promise((resolve) => {
            if ('id' in reqMessage && reqMessage.id !== undefined) {
                this.pending.set(reqMessage.id, resolve);
            }
            if (this.onmessage) {
                this.onmessage(reqMessage);
            } else {
                resolve({
                    jsonrpc: "2.0",
                    id: (reqMessage as any).id,
                    error: { code: -32000, message: "Transport not ready" }
                } as JSONRPCMessage);
            }
        });
    }
}

let globalStatelessTransport: StatelessHttpTransport | null = null;
let activeSseTransports = new Map<string, SSEServerTransport>();

export function isMcpServerRunning(): boolean {
    return serverInstance !== null;
}

function createConfiguredMcpServer(): McpServer {
    const mcpServer = new McpServer({
        name: 'trae-harvester-mcp',
        version: '0.3.0-beta'
    });

    // ==========================================
    // 1. Resources (获取当前状态)
    // ==========================================

    mcpServer.resource(
        'ai-context',
        'harvester://state/ai-context',
        async (uri, variables) => {
            const { getAiContext } = require('../commands/testRunner');
            const aiContext = getAiContext();
            return {
                contents: [{
                    uri: uri.href,
                    text: aiContext || 'No AI context provided.'
                }]
            };
        }
    );

    mcpServer.resource(
        'logs',
        'harvester://state/logs',
        async (uri, variables) => {
            try {
                const logPath = getLogger().getLogFilePath();
                if (fs.existsSync(logPath)) {
                    const content = fs.readFileSync(logPath, 'utf-8');
                    return {
                        contents: [{
                            uri: uri.href,
                            text: content
                        }]
                    };
                }
                return { contents: [{ uri: uri.href, text: 'No logs available.' }] };
            } catch (err: any) {
                return { contents: [{ uri: uri.href, text: `Error reading logs: ${err.message}` }] };
            }
        }
    );

    mcpServer.resource(
        'plan',
        'harvester://state/plan',
        async (uri, variables) => {
            const plan = getCurrentPlan();
            return {
                contents: [{
                    uri: uri.href,
                    text: plan ? JSON.stringify(plan, null, 2) : 'No plan loaded.'
                }]
            };
        }
    );

    mcpServer.resource(
        'test-results',
        'harvester://state/test-results',
        async (uri, variables) => {
            const plan = getCurrentPlan();
            const resultsMap = getStepResults();
            if (!plan) {
                return { contents: [{ uri: uri.href, text: 'No plan loaded.' }] };
            }
            const results = plan.steps.map(s => resultsMap.get(s.step_number) || {
                step_number: s.step_number,
                title: s.title,
                status: 'PENDING'
            });
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(results, null, 2)
                }]
            };
        }
    );

    mcpServer.resource(
        'check-items',
        'harvester://state/check-items',
        async (uri, variables) => {
            const plan = getCurrentPlan();
            const items = plan?.check_items || [];
            return {
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(items, null, 2)
                }]
            };
        }
    );

    // ==========================================
    // 2. Tools (执行控制动作)
    // ==========================================

    mcpServer.tool(
        'trea_harvester_import_test_plan',
        'Use this trea_harvester tool to import a complete JSON string representing the test plan (steps and check_items) and wait for the human to execute it.',
        {
            jsonText: z.string().describe('The JSON string matching the TestPlan format (e.g. {"steps": [...], "check_items": [...]})')
        },
        async ({ jsonText }) => {
            // 高危工具权限检查
            const allowExecution = vscode.workspace.getConfiguration('traeHarvester').get<boolean>('mcpAllowExecution', true);
            if (!allowExecution) {
                return {
                    content: [{ type: 'text', text: '⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.' }],
                    isError: true
                };
            }
            const { importTestPlanJson } = require('../commands/testRunner');
            try {
                importTestPlanJson(jsonText);
                return {
                    content: [{ type: 'text', text: `Test plan imported successfully. Waiting for human to execute the tests.` }]
                };
            } catch (err: any) {
                return {
                    content: [{ type: 'text', text: `Failed to import test plan: ${err.message}` }],
                    isError: true
                };
            }
        }
    );

    mcpServer.tool(
        'trea_harvester_get_evaluation_evidence',
        'Use this trea_harvester tool to gather test results, ai context, and manual check items, returning a complete JSON object for evaluation scoring.',
        {},
        async () => {
            try {
                const config = vscode.workspace.getConfiguration('traeHarvester');
                const outputDir = config.get<string>('patchOutputPath', '/gitdiff_shared');
                
                const { exportGitPatch } = require('../commands/gitPatch');
                let patchContent = '';
                try {
                    await exportGitPatch(outputDir);
                    const { getStoredGitPatchContent } = require('../commands/gitPatch');
                    patchContent = getStoredGitPatchContent();
                } catch (e: any) {
                    patchContent = `Failed to get patch: ${e.message}`;
                }

                const { getTestResultsForEvidence } = require('../commands/testRunner');
                const testResults = getTestResultsForEvidence();

                const evidenceData = {
                    ai_context: testResults?.ai_context || '',
                    git_patch: patchContent,
                    test_results: testResults?.steps || [],
                    manual_check_items: testResults?.check_items || []
                };

                return {
                    content: [{ type: 'text', text: JSON.stringify(evidenceData, null, 2) }]
                };
            } catch (err: any) {
                return {
                    content: [{ type: 'text', text: `Failed to get evidence: ${err.message}` }],
                    isError: true
                };
            }
        }
    );

    mcpServer.tool(
        'trea_harvester_export_patch',
        'Use this trea_harvester tool to export a git patch of the current branch compared to main. Returns the path to the patch file.',
        {},
        async () => {
            try {
                const config = vscode.workspace.getConfiguration('traeHarvester');
                const outputDir = config.get<string>('patchOutputPath', '/gitdiff_shared');
                const { exportGitPatch } = require('../commands/gitPatch');
                const patchFilePath = await exportGitPatch(outputDir);
                return {
                    content: [{ type: 'text', text: `Patch exported successfully to: ${patchFilePath}` }]
                };
            } catch (err: any) {
                return {
                    content: [{ type: 'text', text: `Failed to export patch: ${err.message}` }],
                    isError: true
                };
            }
        }
    );

    mcpServer.tool(
        'trea_harvester_get_git_patch',
        'Use this trea_harvester tool to directly retrieve the git diff patch content that was stored in the plugin during the last export.',
        {},
        async () => {
            const { getStoredGitPatchContent } = require('../commands/gitPatch');
            const patchContent = getStoredGitPatchContent();
            if (!patchContent) {
                return {
                    content: [{ type: 'text', text: 'No git patch has been exported yet. Please run trea_harvester_export_patch first.' }]
                };
            }
            return {
                content: [{ type: 'text', text: patchContent }]
            };
        }
    );

    mcpServer.tool(
        'trea_harvester_run_all_tests',
        'Use this trea_harvester tool to execute all tests defined in the test plan in the terminal.',
        {},
        async () => {
            // 高危工具权限检查
            const allowExecution = vscode.workspace.getConfiguration('traeHarvester').get<boolean>('mcpAllowExecution', true);
            if (!allowExecution) {
                return {
                    content: [{ type: 'text', text: '⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.' }],
                    isError: true
                };
            }
            vscode.commands.executeCommand('trae-harvester.runAllTests');
            return {
                content: [{ type: 'text', text: 'Started running all tests.' }]
            };
        }
    );

    mcpServer.tool(
        'trea_harvester_test_connection',
        'Test the connection to the MCP Server. Called by the model to verify it successfully connected to the extension.',
        {},
        async () => {
            return {
                content: [{ type: 'text', text: '✅ Successfully connected to Trae Harvester MCP Server! You are now able to interact with the plugin.' }]
            };
        }
    );

    // ==========================================
    return mcpServer;
}

export async function startMcpServer() {
    if (serverInstance) {
        return;
    }

    const log = getLogger();
    log.info('MCP', 'Initializing MCP Server...');

    // Setup global stateless transport
    globalStatelessTransport = new StatelessHttpTransport();
    const globalMcpServer = createConfiguredMcpServer();
    await globalMcpServer.connect(globalStatelessTransport);

    const app = express();

    // ==========================================
    // 3. Bearer Token 鉴权中间件
    // ==========================================
    app.use('/mcp', (req: any, res: any, next: any) => {
        const authHeader = req.headers['authorization'];
        if (!currentAuthToken) {
            // Token 还没生成（理论上不该到这里），放行
            next();
            return;
        }
        if (authHeader && authHeader === `Bearer ${currentAuthToken}`) {
            next();
            return;
        }
        log.info('MCP', `🚫 Unauthorized request blocked from ${req.ip}`);
        res.status(401).json({ error: 'Unauthorized. Missing or invalid Bearer token.' });
    });

    // ==========================================
    // 4. 路由挂载 (兼容 SSE 和 纯 HTTP POST)
    // ==========================================
    app.get('/mcp', async (req, res) => {
        log.info('MCP', 'New SSE connection established');
        const sseTransport = new SSEServerTransport('/mcp', res);
        const sseMcpServer = createConfiguredMcpServer();
        await sseMcpServer.connect(sseTransport);
        activeSseTransports.set(sseTransport.sessionId, sseTransport);
    });

    app.post('/mcp', async (req, res) => {
        const sessionId = req.query.sessionId as string;
        if (sessionId) {
            // 路由到对应的 SSE 会话
            const sseTransport = activeSseTransports.get(sessionId);
            if (sseTransport) {
                await sseTransport.handlePostMessage(req, res);
            } else {
                res.status(404).send('Session not found');
            }
        } else {
            // 直接 JSON-RPC POST
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const message = JSON.parse(body);
                    const response = await globalStatelessTransport!.handleHttpRequest(message);
                    res.json(response);
                } catch(e) {
                    res.status(400).send('Invalid JSON');
                }
            });
        }
    });

    const startPort = vscode.workspace.getConfiguration('traeHarvester').get<number>('mcpPort') || 3000;
    
    const tryListen = (port: number) => {
        if (port > startPort + 50) {
            log.error('MCP', 'Could not find an available port for MCP Server.');
            return;
        }
        // ⚡ 强制绑定 127.0.0.1，杜绝局域网/公网访问
        serverInstance = app.listen(port, '127.0.0.1', () => {
            log.info('MCP', `MCP Server listening on http://127.0.0.1:${port}/mcp`);
            const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
            // registerInstance 现在返回生成的 auth_token
            currentAuthToken = registerInstance(port, workspacePath);
            log.info('MCP', `Auth token generated: ${currentAuthToken.substring(0, 8)}...`);
        }).on('error', (err: any) => {
            if (err.code === 'EADDRINUSE') {
                log.info('MCP', `Port ${port} in use, trying ${port + 1}...`);
                serverInstance = null;
                tryListen(port + 1);
            } else {
                log.error('MCP', 'Failed to start MCP Server', err);
            }
        });
    };

    tryListen(startPort);
}

export function stopMcpServer() {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        currentAuthToken = null;
        unregisterInstance();
        globalStatelessTransport = null;
        activeSseTransports.clear();
        getLogger().info('MCP', 'MCP Server stopped.');
    }
}
