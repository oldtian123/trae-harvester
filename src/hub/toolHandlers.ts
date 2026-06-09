// ============================================================
// Trae Harvester — 窗口侧工具执行映射 (Window-Side Tool Handlers)
// ============================================================
// Hub 通过 WS 把大模型的工具调用转发到本窗口后，由这里的 handler 实际执行。
// 复用既有函数（exportGitPatch / getTestResultsForEvidence 等），零重写业务逻辑。
//
// ⚠️ 本文件运行在 VS Code 扩展宿主内，可以 import vscode 和访问配置。

import * as vscode from 'vscode';
import * as fs from 'fs';
import { WindowToolName, WINDOW_TOOLS, ToolResult } from './protocol';
import { exportGitPatch, getStoredGitPatchContent } from '../commands/gitPatch';
import {
    getTestResultsForEvidence,
    importTestPlanJson,
    getAiContext,
    getCurrentPlan,
    getStepResults
} from '../commands/testRunner';
import { getLogger } from '../utils/logger';

function textResult(text: string, isError = false): ToolResult {
    return { content: [{ type: 'text', text }], isError };
}

/**
 * 工具名 → 实际执行函数的映射。
 * Hub 发来 tool_request 后，hubClient 调 dispatch(tool, args)。
 */
export async function dispatchToolCall(tool: WindowToolName, args: Record<string, unknown>): Promise<ToolResult> {
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const allowExecution = config.get<boolean>('mcpAllowExecution', true);

    try {
        switch (tool) {
            case WINDOW_TOOLS.GET_EVIDENCE: {
                // 组装完整证据：导出 patch + 获取测试结果 + AI 上下文
                const outputDir = config.get<string>('patchOutputPath', '/gitdiff_shared');
                let patchContent = '';
                try {
                    await exportGitPatch(outputDir);
                    patchContent = getStoredGitPatchContent();
                } catch (e: any) {
                    patchContent = `Failed to get patch: ${e.message}`;
                }
                const testResults = getTestResultsForEvidence();
                const evidenceData = {
                    ai_context: testResults?.ai_context || '',
                    git_patch: patchContent,
                    test_results: testResults?.steps || [],
                    manual_check_items: testResults?.check_items || [],
                };
                return textResult(JSON.stringify(evidenceData, null, 2));
            }

            case WINDOW_TOOLS.EXPORT_PATCH: {
                const outputDir = config.get<string>('patchOutputPath', '/gitdiff_shared');
                const patchFilePath = await exportGitPatch(outputDir);
                return textResult(`Patch exported successfully to: ${patchFilePath}`);
            }

            case WINDOW_TOOLS.GET_GIT_PATCH: {
                const patchContent = getStoredGitPatchContent();
                if (!patchContent) {
                    return textResult('No git patch has been exported yet. Please run trea_harvester_export_patch first.');
                }
                return textResult(patchContent);
            }

            case WINDOW_TOOLS.RUN_ALL_TESTS: {
                if (!allowExecution) {
                    return textResult('⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.', true);
                }
                vscode.commands.executeCommand('trae-harvester.runAllTests');
                return textResult('Started running all tests.');
            }

            case WINDOW_TOOLS.IMPORT_TEST_PLAN: {
                if (!allowExecution) {
                    return textResult('⛔ Permission denied: MCP execution mode is disabled (traeHarvester.mcpAllowExecution = false). This tool is read-only.', true);
                }
                const jsonText = args.jsonText as string;
                if (!jsonText) {
                    return textResult('Missing required parameter: jsonText', true);
                }
                importTestPlanJson(jsonText);
                return textResult('Test plan imported successfully. Waiting for human to execute the tests.');
            }

            case WINDOW_TOOLS.GET_AI_CONTEXT: {
                const aiContext = getAiContext();
                return textResult(aiContext || 'No AI context provided.');
            }

            case WINDOW_TOOLS.GET_PLAN: {
                const plan = getCurrentPlan();
                return textResult(plan ? JSON.stringify(plan, null, 2) : 'No plan loaded.');
            }

            case WINDOW_TOOLS.GET_TEST_RESULTS: {
                const plan = getCurrentPlan();
                const resultsMap = getStepResults();
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

            case WINDOW_TOOLS.GET_CHECK_ITEMS: {
                const plan = getCurrentPlan();
                const items = plan?.check_items || [];
                return textResult(JSON.stringify(items, null, 2));
            }

            case WINDOW_TOOLS.GET_LOGS: {
                const logPath = getLogger().getLogFilePath();
                if (fs.existsSync(logPath)) {
                    const content = fs.readFileSync(logPath, 'utf-8');
                    return textResult(content);
                }
                return textResult('No logs available.');
            }

            default:
                return textResult(`Unknown tool: ${tool}`, true);
        }
    } catch (err: any) {
        getLogger().error('ToolHandler', `Tool ${tool} execution failed`, err);
        return textResult(`Failed to execute ${tool}: ${err?.message || err}`, true);
    }
}
