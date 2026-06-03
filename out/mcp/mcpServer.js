"use strict";
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
exports.isMcpServerRunning = isMcpServerRunning;
exports.startMcpServer = startMcpServer;
exports.stopMcpServer = stopMcpServer;
const vscode = __importStar(require("vscode"));
const express_1 = __importDefault(require("express"));
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const sse_js_1 = require("@modelcontextprotocol/sdk/server/sse.js");
const zod_1 = require("zod");
const fs = __importStar(require("fs"));
const logger_1 = require("../utils/logger");
const testRunner_1 = require("../commands/testRunner");
let serverInstance = null;
// ==========================================
// Stateless HTTP Transport (For Codex direct POST)
// ==========================================
class StatelessHttpTransport {
    constructor() {
        this.pending = new Map();
    }
    async start() { }
    async close() { }
    async send(message) {
        if ('id' in message && message.id !== undefined) {
            const resolve = this.pending.get(message.id);
            if (resolve) {
                resolve(message);
                this.pending.delete(message.id);
            }
        }
    }
    async handleHttpRequest(reqMessage) {
        return new Promise((resolve) => {
            if ('id' in reqMessage && reqMessage.id !== undefined) {
                this.pending.set(reqMessage.id, resolve);
            }
            if (this.onmessage) {
                this.onmessage(reqMessage);
            }
            else {
                resolve({
                    jsonrpc: "2.0",
                    id: reqMessage.id,
                    error: { code: -32000, message: "Transport not ready" }
                });
            }
        });
    }
}
let globalStatelessTransport = null;
let activeSseTransports = new Map();
function isMcpServerRunning() {
    return serverInstance !== null;
}
function createConfiguredMcpServer() {
    const mcpServer = new mcp_js_1.McpServer({
        name: 'trae-harvester-mcp',
        version: '0.3.0-beta'
    });
    // ==========================================
    // 1. Resources (获取当前状态)
    // ==========================================
    mcpServer.resource('ai-context', 'harvester://state/ai-context', async (uri, variables) => {
        const { getAiContext } = require('../commands/testRunner');
        const aiContext = getAiContext();
        return {
            contents: [{
                    uri: uri.href,
                    text: aiContext || 'No AI context provided.'
                }]
        };
    });
    mcpServer.resource('logs', 'harvester://state/logs', async (uri, variables) => {
        try {
            const logPath = (0, logger_1.getLogger)().getLogFilePath();
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
        }
        catch (err) {
            return { contents: [{ uri: uri.href, text: `Error reading logs: ${err.message}` }] };
        }
    });
    mcpServer.resource('plan', 'harvester://state/plan', async (uri, variables) => {
        const plan = (0, testRunner_1.getCurrentPlan)();
        return {
            contents: [{
                    uri: uri.href,
                    text: plan ? JSON.stringify(plan, null, 2) : 'No plan loaded.'
                }]
        };
    });
    mcpServer.resource('test-results', 'harvester://state/test-results', async (uri, variables) => {
        const plan = (0, testRunner_1.getCurrentPlan)();
        const resultsMap = (0, testRunner_1.getStepResults)();
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
    });
    mcpServer.resource('check-items', 'harvester://state/check-items', async (uri, variables) => {
        const plan = (0, testRunner_1.getCurrentPlan)();
        const items = plan?.check_items || [];
        return {
            contents: [{
                    uri: uri.href,
                    text: JSON.stringify(items, null, 2)
                }]
        };
    });
    // ==========================================
    // 2. Tools (执行控制动作)
    // ==========================================
    mcpServer.tool('trea_harvester_import_test_plan', 'Use this trea_harvester tool to import a complete JSON string representing the test plan (steps and check_items) and wait for the human to execute it.', {
        jsonText: zod_1.z.string().describe('The JSON string matching the TestPlan format (e.g. {"steps": [...], "check_items": [...]})')
    }, async ({ jsonText }) => {
        const { importTestPlanJson } = require('../commands/testRunner');
        try {
            importTestPlanJson(jsonText);
            return {
                content: [{ type: 'text', text: `Test plan imported successfully. Waiting for human to execute the tests.` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to import test plan: ${err.message}` }],
                isError: true
            };
        }
    });
    mcpServer.tool('trea_harvester_get_evaluation_evidence', 'Use this trea_harvester tool to gather test results, ai context, and manual check items, returning a complete JSON object for evaluation scoring.', {}, async () => {
        try {
            const config = vscode.workspace.getConfiguration('traeHarvester');
            const outputDir = config.get('patchOutputPath', '/gitdiff_shared');
            const { exportGitPatch } = require('../commands/gitPatch');
            let patchContent = '';
            try {
                await exportGitPatch(outputDir);
                const { getStoredGitPatchContent } = require('../commands/gitPatch');
                patchContent = getStoredGitPatchContent();
            }
            catch (e) {
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
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to get evidence: ${err.message}` }],
                isError: true
            };
        }
    });
    mcpServer.tool('trea_harvester_export_patch', 'Use this trea_harvester tool to export a git patch of the current branch compared to main. Returns the path to the patch file.', {}, async () => {
        try {
            const config = vscode.workspace.getConfiguration('traeHarvester');
            const outputDir = config.get('patchOutputPath', '/gitdiff_shared');
            const { exportGitPatch } = require('../commands/gitPatch');
            const patchFilePath = await exportGitPatch(outputDir);
            return {
                content: [{ type: 'text', text: `Patch exported successfully to: ${patchFilePath}` }]
            };
        }
        catch (err) {
            return {
                content: [{ type: 'text', text: `Failed to export patch: ${err.message}` }],
                isError: true
            };
        }
    });
    mcpServer.tool('trea_harvester_get_git_patch', 'Use this trea_harvester tool to directly retrieve the git diff patch content that was stored in the plugin during the last export.', {}, async () => {
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
    });
    mcpServer.tool('trea_harvester_run_all_tests', 'Use this trea_harvester tool to execute all tests defined in the test plan in the terminal.', {}, async () => {
        vscode.commands.executeCommand('trae-harvester.runAllTests');
        return {
            content: [{ type: 'text', text: 'Started running all tests.' }]
        };
    });
    mcpServer.tool('trea_harvester_test_connection', 'Test the connection to the MCP Server. Called by the model to verify it successfully connected to the extension.', {}, async () => {
        return {
            content: [{ type: 'text', text: '✅ Successfully connected to Trae Harvester MCP Server! You are now able to interact with the plugin.' }]
        };
    });
    // ==========================================
    return mcpServer;
}
async function startMcpServer() {
    if (serverInstance) {
        return;
    }
    const log = (0, logger_1.getLogger)();
    log.info('MCP', 'Initializing MCP Server...');
    // Setup global stateless transport
    globalStatelessTransport = new StatelessHttpTransport();
    const globalMcpServer = createConfiguredMcpServer();
    await globalMcpServer.connect(globalStatelessTransport);
    const app = (0, express_1.default)();
    // ==========================================
    // 3. 路由挂载 (兼容 SSE 和 纯 HTTP POST)
    // ==========================================
    app.get('/mcp', async (req, res) => {
        log.info('MCP', 'New SSE connection established');
        const sseTransport = new sse_js_1.SSEServerTransport('/mcp', res);
        const sseMcpServer = createConfiguredMcpServer();
        await sseMcpServer.connect(sseTransport);
        activeSseTransports.set(sseTransport.sessionId, sseTransport);
    });
    app.post('/mcp', async (req, res) => {
        const sessionId = req.query.sessionId;
        if (sessionId) {
            // 路由到对应的 SSE 会话
            const sseTransport = activeSseTransports.get(sessionId);
            if (sseTransport) {
                await sseTransport.handlePostMessage(req, res);
            }
            else {
                res.status(404).send('Session not found');
            }
        }
        else {
            // 直接 JSON-RPC POST
            let body = '';
            req.on('data', chunk => body += chunk.toString());
            req.on('end', async () => {
                try {
                    const message = JSON.parse(body);
                    const response = await globalStatelessTransport.handleHttpRequest(message);
                    res.json(response);
                }
                catch (e) {
                    res.status(400).send('Invalid JSON');
                }
            });
        }
    });
    const port = vscode.workspace.getConfiguration('traeHarvester').get('mcpPort') || 3000;
    serverInstance = app.listen(port, () => {
        log.info('MCP', `MCP Server listening on http://localhost:${port}/mcp`);
    });
}
function stopMcpServer() {
    if (serverInstance) {
        serverInstance.close();
        serverInstance = null;
        globalStatelessTransport = null;
        activeSseTransports.clear();
        (0, logger_1.getLogger)().info('MCP', 'MCP Server stopped.');
    }
}
//# sourceMappingURL=mcpServer.js.map