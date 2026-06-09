"use strict";
// ============================================================
// Trae Harvester — 窗口侧工具执行映射 (Window-Side Tool Handlers)
// ============================================================
// Hub 通过 WS 把大模型的工具调用转发到本窗口后，由这里的 handler 实际执行。
// 复用既有函数（exportGitPatch / getTestResultsForEvidence 等），零重写业务逻辑。
//
// ⚠️ 本文件运行在 VS Code 扩展宿主内，可以 import vscode 和访问配置。
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchToolCall = dispatchToolCall;
const vscode = __importStar(require("vscode"));
const fs = __importStar(require("fs"));
const protocol_1 = require("./protocol");
const gitPatch_1 = require("../commands/gitPatch");
const testRunner_1 = require("../commands/testRunner");
const logger_1 = require("../utils/logger");
function textResult(text, isError = false) {
    return { content: [{ type: 'text', text }], isError };
}
/**
 * 工具名 → 实际执行函数的映射。
 * Hub 发来 tool_request 后，hubClient 调 dispatch(tool, args)。
 */
async function dispatchToolCall(tool, args) {
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const allowExecution = config.get('mcpAllowExecution', true);
    try {
        switch (tool) {
            case protocol_1.WINDOW_TOOLS.GET_EVIDENCE: {
                // 组装完整证据：导出 patch + 获取测试结果 + AI 上下文
                const outputDir = config.get('patchOutputPath', '/gitdiff_shared');
                let patchContent = '';
                try {
                    await (0, gitPatch_1.exportGitPatch)(outputDir);
                    patchContent = (0, gitPatch_1.getStoredGitPatchContent)();
                }
                catch (e) {
                    patchContent = `Failed to get patch: ${e.message}`;
                }
                const testResults = (0, testRunner_1.getTestResultsForEvidence)();
                const evidenceData = {
                    ai_context: testResults?.ai_context || '',
                    git_patch: patchContent,
                    test_results: testResults?.steps || [],
                    manual_check_items: testResults?.check_items || [],
                };
                return textResult(JSON.stringify(evidenceData, null, 2));
            }
            case protocol_1.WINDOW_TOOLS.EXPORT_PATCH: {
                const outputDir = config.get('patchOutputPath', '/gitdiff_shared');
                const patchFilePath = await (0, gitPatch_1.exportGitPatch)(outputDir);
                return textResult(`Patch exported successfully to: ${patchFilePath}`);
            }
            case protocol_1.WINDOW_TOOLS.GET_GIT_PATCH: {
                const patchContent = (0, gitPatch_1.getStoredGitPatchContent)();
                if (!patchContent) {
                    return textResult('No git patch has been exported yet. Please run trea_harvester_export_patch first.');
                }
                return textResult(patchContent);
            }
            case protocol_1.WINDOW_TOOLS.RUN_ALL_TESTS: {
                if (!allowExecution) {
                    return textResult('⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.', true);
                }
                vscode.commands.executeCommand('trae-harvester.runAllTests');
                return textResult('Started running all tests.');
            }
            case protocol_1.WINDOW_TOOLS.IMPORT_TEST_PLAN: {
                if (!allowExecution) {
                    return textResult('⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.', true);
                }
                const jsonText = args.jsonText;
                if (!jsonText) {
                    return textResult('Missing required parameter: jsonText', true);
                }
                (0, testRunner_1.importTestPlanJson)(jsonText);
                return textResult('Test plan imported successfully. Waiting for human to execute the tests.');
            }
            case protocol_1.WINDOW_TOOLS.GET_AI_CONTEXT: {
                const aiContext = (0, testRunner_1.getAiContext)();
                return textResult(aiContext || 'No AI context provided.');
            }
            case protocol_1.WINDOW_TOOLS.GET_PLAN: {
                const plan = (0, testRunner_1.getCurrentPlan)();
                return textResult(plan ? JSON.stringify(plan, null, 2) : 'No plan loaded.');
            }
            case protocol_1.WINDOW_TOOLS.GET_TEST_RESULTS: {
                const plan = (0, testRunner_1.getCurrentPlan)();
                const resultsMap = (0, testRunner_1.getStepResults)();
                if (!plan) {
                    return textResult('No plan loaded.');
                }
                const results = plan.steps.map(s => resultsMap.get(s.step_number) || {
                    step_number: s.step_number,
                    title: s.title,
                    status: 'PENDING'
                });
                return textResult(JSON.stringify(results, null, 2));
            }
            case protocol_1.WINDOW_TOOLS.GET_CHECK_ITEMS: {
                const plan = (0, testRunner_1.getCurrentPlan)();
                const items = plan?.check_items || [];
                return textResult(JSON.stringify(items, null, 2));
            }
            case protocol_1.WINDOW_TOOLS.GET_LOGS: {
                const logPath = (0, logger_1.getLogger)().getLogFilePath();
                if (fs.existsSync(logPath)) {
                    const content = fs.readFileSync(logPath, 'utf-8');
                    return textResult(content);
                }
                return textResult('No logs available.');
            }
            default:
                return textResult(`Unknown tool: ${tool}`, true);
        }
    }
    catch (err) {
        (0, logger_1.getLogger)().error('ToolHandler', `Tool ${tool} execution failed`, err);
        return textResult(`Failed to execute ${tool}: ${err?.message || err}`, true);
    }
}
//# sourceMappingURL=toolHandlers.js.map