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
import { resolveOutputPath } from '../utils/pathResolver';

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
                // 组装完整证据：导出 patch + 获取测试结果 + AI 上下文 + 会话元信息
                const outputDir = resolveOutputPath('patch');
                let patchContent = '';
                try {
                    await exportGitPatch(outputDir);
                    patchContent = getStoredGitPatchContent();
                } catch (e: any) {
                    patchContent = `Failed to get patch: ${e.message}`;
                }

                // 显式获取 AI Context
                const aiContext = getAiContext();
                const testResults = getTestResultsForEvidence();
                const currentPlan = getCurrentPlan();

                // 获取当前分支
                const { getCurrentBranch } = require('../commands/gitPatch');
                let currentBranch = 'unknown';
                try {
                    currentBranch = await getCurrentBranch();
                } catch (e) {
                    currentBranch = 'unknown';
                }

                // 组装完整 evidence（包含会话元信息）
                const evidenceData = {
                    session_id: args.session_id || 'unknown',
                    workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown',
                    repo_id: currentPlan?.repo_id || 'unknown',
                    branch: currentBranch,
                    model_id: currentPlan?.model_id || 'unknown',
                    prompt_id: currentPlan?.prompt_id || 'unknown',
                    ai_context: aiContext || testResults?.ai_context || '',
                    git_patch: patchContent,
                    test_plan: currentPlan || null,
                    test_results: testResults?.steps || [],
                    manual_check_items: testResults?.check_items || [],
                };
                return textResult(JSON.stringify(evidenceData, null, 2));
            }

            case WINDOW_TOOLS.COLLECT_ALL: {
                // 聚合采集工具：根据选项自动执行并收集所有评分材料
                const options = {
                    ensure_patch: args.ensure_patch !== false,
                    ensure_tests: args.ensure_tests !== false,
                    run_tests_if_missing: args.run_tests_if_missing === true,
                    include_ai_context: args.include_ai_context !== false,
                    include_logs: args.include_logs === true,
                };

                const outputDir = resolveOutputPath('patch');
                const result: any = {
                    session_id: args.session_id || 'unknown',
                    workspace: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'unknown',
                };

                // 1. 获取测试计划和元信息
                const currentPlan = getCurrentPlan();
                result.repo_id = currentPlan?.repo_id || 'unknown';
                result.model_id = currentPlan?.model_id || 'unknown';
                result.prompt_id = currentPlan?.prompt_id || 'unknown';
                result.test_plan = currentPlan || null;

                // 2. 获取分支
                const { getCurrentBranch } = require('../commands/gitPatch');
                try {
                    result.branch = await getCurrentBranch();
                } catch (e) {
                    result.branch = 'unknown';
                }

                // 3. 确保测试计划存在
                if (options.ensure_tests && !currentPlan) {
                    result.warnings = result.warnings || [];
                    result.warnings.push('No test plan loaded. Use trae_harvester_import_test_plan to import one.');
                }

                // 4. 运行测试（如果需要且允许）
                if (options.run_tests_if_missing && currentPlan && allowExecution) {
                    const resultsMap = getStepResults();
                    const hasPendingSteps = currentPlan.steps.some(s => !resultsMap.get(s.step_number));

                    if (hasPendingSteps) {
                        getLogger().info('ToolHandlers', 'Running tests as requested by collect_all...');
                        vscode.commands.executeCommand('trae-harvester.runAllTests');
                        result.info = result.info || [];
                        result.info.push('Started running tests. Use trae_harvester_get_test_results to poll results.');
                    }
                }

                // 5. 获取测试结果
                if (options.ensure_tests) {
                    const testResults = getTestResultsForEvidence();
                    result.test_results = testResults?.steps || [];
                    result.manual_check_items = testResults?.check_items || [];
                }

                // 6. 确保 Patch
                if (options.ensure_patch) {
                    try {
                        await exportGitPatch(outputDir);
                        result.git_patch = getStoredGitPatchContent();
                    } catch (e: any) {
                        result.git_patch = `Failed to export patch: ${e.message}`;
                    }
                }

                // 7. 包含 AI Context
                if (options.include_ai_context) {
                    result.ai_context = getAiContext() || '';
                }

                // 8. 包含日志（可选）
                if (options.include_logs) {
                    result.logs = 'Log export not implemented. Use trae_harvester_get_logs instead.';
                }

                return textResult(JSON.stringify(result, null, 2));
            }

            case WINDOW_TOOLS.EXPORT_PATCH: {
                const outputDir = resolveOutputPath('patch');
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
