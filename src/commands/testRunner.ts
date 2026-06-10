// ============================================================
// Trae Harvester — 功能二：动态测试命令编排与捕获
// ============================================================
// 数据流：用户粘贴 JSON → 解析步骤 → 侧边栏渲染 → 逐步/全自动执行 → 输出 test_result.json

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runShellCommand } from '../utils/shell';
import { writeJson } from '../utils/fileUtils';
import { TestPlan, TestStep, StepResult, TestResult, SessionStatus } from '../types';
import { getLogger } from '../utils/logger';
import { pushSessionUpdate } from '../hub/windowServer';
import { exportGitPatch } from './gitPatch';
import { resolveOutputPath } from '../utils/pathResolver';

/** 当前加载的测试计划（模块级状态） */
let currentPlan: TestPlan | null = null;
/** 当前的步骤结果（模块级状态，支持增量执行） */
let stepResults: Map<number, StepResult> = new Map();
/** 侧边栏 Webview 引用（由 Provider 设置） */
let webviewRef: vscode.Webview | null = null;
/** AI 生成的上下文（供 MCP 读取用于评分） */
let currentAiContext: string = '';

/**
 * 敏感信息脱敏：替换掉各种输出里的 Github Token
 */
function sanitizeText(text: string): string {
    if (!text) return text;
    const configToken = vscode.workspace.getConfiguration('traeHarvester').get<string>('githubToken');
    const githubToken = configToken || process.env.GITHUB_TOKEN;
    if (githubToken && githubToken.trim() !== '') {
        return text.split(githubToken).join('***');
    }
    return text;
}

function getResultFileName(): string {
    let branchName = 'test';
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (workspaceFolder) {
            const execSync = require('child_process').execSync;
            const branch = execSync('git branch --show-current', { cwd: workspaceFolder, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
            if (branch) {
                branchName = branch.replace(/[^a-zA-Z0-9.\-_]/g, '_');
            }
        }
    } catch (e) {
        // ignore
    }
    return `${branchName}_result.json`;
}

/**
 * 更新测试计划的模型和Prompt标识
 */
export function updatePlanIdentifiers(repoId?: string, branch?: string, modelId?: string, promptId?: string): void {
    if (!currentPlan) {
        currentPlan = { steps: [], check_items: [], repo_id: repoId, model_id: modelId, prompt_id: promptId };
    } else {
        if (repoId !== undefined) currentPlan.repo_id = repoId;
        if (modelId !== undefined) currentPlan.model_id = modelId;
        if (promptId !== undefined) currentPlan.prompt_id = promptId;
    }

    // Check current overall status based on stepResults
    let status: SessionStatus = 'IDLE';
    if (currentPlan.steps.length > 0) {
        const hasPending = currentPlan.steps.some(s => {
            const r = stepResults.get(s.step_number);
            return !r || r.status === 'PENDING';
        });
        const hasCompleted = currentPlan.steps.some(s => {
            const r = stepResults.get(s.step_number);
            return r && ['PASS', 'FAIL', 'ERROR', 'TIMEOUT', 'SKIP'].includes(r.status);
        });
        if (!hasPending && hasCompleted) {
            status = 'COMPLETED';
        } else if (hasCompleted || currentPlan.steps.length > 0) {
            status = 'RUNNING';
        }
    }

    pushSessionUpdate({ status, model_id: modelId, prompt_id: promptId });

    // Automatically snapshot history if completed
    if (status === 'COMPLETED') {
        saveHistorySnapshot();
    }
}

/**
 * 将结果留存至本地历史记录错题本
 */
async function saveHistorySnapshot() {
    if (!currentPlan) return;
    try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceFolder) return;
        
        const historyDir = path.join(workspaceFolder, '.trae_harvester_history');
        if (!fs.existsSync(historyDir)) {
            fs.mkdirSync(historyDir, { recursive: true });
        }
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const modelId = currentPlan.model_id || 'UnknownModel';
        const promptId = currentPlan.prompt_id || 'UnknownPrompt';
        
        // 生成快照
        const allResults: StepResult[] = currentPlan.steps.map(s => stepResults.get(s.step_number) || {
            step_number: s.step_number,
            title: s.title,
            command: s.command,
            status: 'PENDING',
            exit_code: null,
            duration_ms: 0,
            console_output: ''
        });
        
        const testResult = buildTestResult(allResults, currentPlan.steps.length);
        testResult.model_id = modelId;
        testResult.prompt_id = promptId;
        
        // 获取 Patch
        let patchContent = '';
        try {
            const { getStoredGitPatchContent } = require('./gitPatch');
            patchContent = getStoredGitPatchContent();
            if (!patchContent) {
                // 如果内存没有，现场导出一份到临时目录并读取
                const tmpDir = path.join(os.tmpdir(), 'trae_harvester_tmp');
                await exportGitPatch(tmpDir);
                patchContent = getStoredGitPatchContent();
            }
        } catch (e) {
            patchContent = `Failed to get patch: ${e}`;
        }
        
        const snapshotFile = path.join(historyDir, `${timestamp}_${modelId}_${promptId}.json`);
        const snapshotData = {
            test_result: testResult,
            git_patch: patchContent
        };
        
        fs.writeFileSync(snapshotFile, JSON.stringify(snapshotData, null, 2), 'utf-8');
        getLogger().info('TestRunner', `History snapshot saved: ${snapshotFile}`);
    } catch (e: any) {
        getLogger().error('TestRunner', 'Failed to save history snapshot', e);
    }
}

// ==========================================
// 暴露的方法供 Webview 侧调用或刷新
// ==========================================

/**
 * 获取 AI Context（供 MCP 调用）
 */
export function getAiContext(): string {
    return currentAiContext;
}

/**
 * 设置 AI Context（供前端面板调用）
 */
export function setAiContext(text: string): void {
    currentAiContext = text;
}

/**
 * 同步当前测试计划状态到 Webview
 */
export function syncPlanToWebview(): void {
    if (!webviewRef) return;
    const { isMcpServerRunning } = require('../mcp/mcpServer');
    webviewRef.postMessage({
        command: 'loadSteps',
        steps: currentPlan?.steps || [],
        checkItems: currentPlan?.check_items || []
    });
}

/**
 * 供一键清除功能调用的重置所有状态
 */
export function clearAllState(): void {
    currentPlan = null;
    stepResults.clear();
    currentAiContext = '';
    syncPlanToWebview();
}

/**
 * 设置 Webview 引用（由 TestPanelProvider 调用）
 */
export function setWebviewRef(webview: vscode.Webview | null): void {
    webviewRef = webview;
}

/**
 * 获取当前测试计划
 */
export function getCurrentPlan(): TestPlan | null {
    return currentPlan;
}

/**
 * 获取当前步骤结果
 */
export function getStepResults(): Map<number, StepResult> {
    return stepResults;
}

/**
 * 解析用户输入的测试步骤 JSON。
 * 支持严格和宽松的 JSON 格式。
 */
function parseTestPlan(jsonText: string): TestPlan {
    let parsed: any;
    try {
        parsed = JSON.parse(jsonText);
    } catch (err: any) {
        throw new Error(`JSON 解析失败: ${err.message}`);
    }

    // 验证结构
    if (!parsed.steps || !Array.isArray(parsed.steps)) {
        throw new Error('JSON 格式错误: 缺少 "steps" 数组');
    }

    const steps: TestStep[] = parsed.steps.map((s: any, index: number) => {
        if (!s.command || typeof s.command !== 'string') {
            throw new Error(`步骤 ${index + 1} 缺少有效的 "command" 字段`);
        }
        return {
            step_number: s.step_number ?? index + 1,
            title: s.title ?? `Step ${index + 1}`,
            command: s.command,
            cwd: s.cwd,
            timeout: s.timeout,
        };
    });

    if (steps.length === 0) {
        throw new Error('测试计划为空: steps 数组中没有任何步骤');
    }

    let check_items: import('../types').CheckItem[] = [];
    if (Array.isArray(parsed.check_items)) {
        check_items = parsed.check_items.map((item: any) => {
            if (typeof item === 'string') {
                return { text: item, passed: false };
            }
            if (typeof item === 'object' && item !== null && typeof item.text === 'string') {
                return { text: item.text, passed: !!item.passed };
            }
            return { text: String(item), passed: false };
        });
    }

    return { steps, check_items };
}

/**
 * 执行单个测试步骤。
 * 使用 spawn + 异步阻塞监听，确保完整捕获输出。
 */
async function executeStep(step: TestStep, cwd: string, timeoutMs: number): Promise<StepResult> {
    const log = getLogger();
    const startTime = Date.now();
    log.subSeparator(`步骤 #${step.step_number}: ${step.title}`);
    log.detail('命令', step.command);
    log.detail('工作目录', step.cwd || '(默认)');

    // 通知 Webview 步骤开始
    webviewRef?.postMessage({
        command: 'stepStarted',
        stepNumber: step.step_number,
    });

    try {
        const path = require('path');
        const effectiveCwd = step.cwd ? path.resolve(cwd, step.cwd) : cwd;
        const effectiveTimeout = step.timeout || timeoutMs;

        const result = await runShellCommand(step.command, effectiveCwd, effectiveTimeout);

        const durationMs = Date.now() - startTime;
        const consoleOutput = sanitizeText([
            result.stdout,
            result.stderr ? `\n[STDERR]\n${result.stderr}` : '',
        ].join(''));

        const stepResult: StepResult = {
            step_number: step.step_number,
            title: step.title,
            command: step.command,
            status: result.timedOut ? 'TIMEOUT' : (result.exitCode === 0 ? 'PASS' : 'FAIL'),
            exit_code: result.exitCode,
            duration_ms: durationMs,
            console_output: consoleOutput,
            error_message: result.timedOut
                ? `命令执行超时 (${effectiveTimeout}ms)`
                : (result.exitCode !== 0 ? result.stderr.trim() || undefined : undefined),
        };

        log.detail('状态', stepResult.status);
        log.detail('退出码', String(stepResult.exit_code));
        log.detail('耗时', `${durationMs}ms`);
        if (stepResult.console_output.length > 0) {
            log.detail('输出长度', `${stepResult.console_output.length} 字符`);
        }
        if (stepResult.error_message) {
            log.detail('错误', stepResult.error_message);
        }
        log.subEnd(stepResult.status);

        // 通知 Webview 步骤完成
        webviewRef?.postMessage({
            command: 'stepCompleted',
            stepNumber: step.step_number,
            result: stepResult,
        });

        return stepResult;
    } catch (err: any) {
        const durationMs = Date.now() - startTime;
        const stepResult: StepResult = {
            step_number: step.step_number,
            title: step.title,
            command: step.command,
            status: 'ERROR',
            exit_code: -1,
            duration_ms: durationMs,
            console_output: '',
            error_message: `执行异常: ${err.message}`,
        };

        webviewRef?.postMessage({
            command: 'stepCompleted',
            stepNumber: step.step_number,
            result: stepResult,
        });

        return stepResult;
    }
}

/**
 * 构建最终的 TestResult 汇总。
 */
function buildTestResult(results: StepResult[], totalSteps: number): TestResult {
    const passedSteps = results.filter(r => r.status === 'PASS').length;
    const failedSteps = results.filter(r => ['FAIL', 'ERROR', 'TIMEOUT'].includes(r.status)).length;
    const skippedSteps = results.filter(r => r.status === 'SKIP' || r.status === 'PENDING').length;

    let finalStatus: TestResult['final_status'];
    if (failedSteps === 0 && passedSteps === totalSteps) {
        finalStatus = 'PASS';
    } else if (failedSteps === totalSteps) {
        finalStatus = 'FAIL';
    } else {
        finalStatus = 'PARTIAL';
    }

    return {
        timestamp: new Date().toISOString(),
        final_status: finalStatus,
        total_steps: totalSteps,
        passed_steps: passedSteps,
        failed_steps: failedSteps,
        skipped_steps: skippedSteps,
        steps: results,
        check_items: currentPlan?.check_items
    };
}

/**
 * 顺序执行所有测试步骤（全自动模式）。
 */
async function runAllSteps(outputDir: string): Promise<void> {
    if (!currentPlan || currentPlan.steps.length === 0) {
        vscode.window.showWarningMessage('⚠️ 没有加载测试计划，请先输入测试步骤 JSON');
        return;
    }

    const log = getLogger();
    log.separator('功能二：测试命令全自动执行');
    log.timerStart('runAllTests');
    log.info('TestRunner', `共 ${currentPlan!.steps.length} 个测试步骤`);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/';
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const timeoutMs = config.get<number>('commandTimeout', 300000);
    log.info('TestRunner', `工作目录: ${workspaceFolder}`);
    log.info('TestRunner', `超时设置: ${timeoutMs}ms`);

    // 清空之前的结果
    stepResults.clear();

    const results: StepResult[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: 'Trae Harvester: 执行测试中...',
            cancellable: true,
        },
        async (progress, token) => {
            for (let i = 0; i < currentPlan!.steps.length; i++) {
                if (token.isCancellationRequested) {
                    // 用户取消：标记后续步骤为 SKIP
                    for (let j = i; j < currentPlan!.steps.length; j++) {
                        const skipResult: StepResult = {
                            step_number: currentPlan!.steps[j].step_number,
                            title: currentPlan!.steps[j].title,
                            command: currentPlan!.steps[j].command,
                            status: 'SKIP',
                            exit_code: null,
                            duration_ms: 0,
                            console_output: '用户取消执行',
                        };
                        results.push(skipResult);
                        stepResults.set(skipResult.step_number, skipResult);
                    }
                    break;
                }

                const step = currentPlan!.steps[i];
                progress.report({
                    message: `[${i + 1}/${currentPlan!.steps.length}] ${step.title}`,
                    increment: (100 / currentPlan!.steps.length),
                });

                const result = await executeStep(step, workspaceFolder, timeoutMs);
                results.push(result);
                stepResults.set(result.step_number, result);

                // 如果步骤失败，继续执行后续步骤但记录
                if (result.status === 'FAIL' || result.status === 'ERROR' || result.status === 'TIMEOUT') {
                    const continueExecution = await vscode.window.showWarningMessage(
                        `⚠️ 步骤 ${step.step_number} "${step.title}" 失败 (${result.status})。是否继续执行后续步骤？`,
                        '继续', '中断'
                    );

                    if (continueExecution === '中断') {
                        // 标记后续步骤为 SKIP
                        for (let j = i + 1; j < currentPlan!.steps.length; j++) {
                            const skipResult: StepResult = {
                                step_number: currentPlan!.steps[j].step_number,
                                title: currentPlan!.steps[j].title,
                                command: currentPlan!.steps[j].command,
                                status: 'SKIP',
                                exit_code: null,
                                duration_ms: 0,
                                console_output: '前置步骤失败，用户选择中断',
                            };
                            results.push(skipResult);
                            stepResults.set(skipResult.step_number, skipResult);
                        }
                        break;
                    }
                }
            }
        }
    );

    // 生成汇总结果
    const testResult = buildTestResult(results, currentPlan!.steps.length);

    // 写入动态命名的结果文件
    const outputPath = path.join(outputDir, getResultFileName());
    await writeJson(outputPath, testResult);
    log.info('TestRunner', `结果已写入: ${outputPath}`);
    log.timerEnd('runAllTests');
    log.setSuccess(`测试完成: ${testResult.passed_steps}/${testResult.total_steps}`);

    // 通知 Webview
    webviewRef?.postMessage({
        command: 'allCompleted',
        result: testResult,
    });
    
    // Update registry status to COMPLETED
    pushSessionUpdate({ status: 'COMPLETED', model_id: currentPlan.model_id, prompt_id: currentPlan.prompt_id });
    saveHistorySnapshot();

    const icon = testResult.final_status === 'PASS' ? '✅' : testResult.final_status === 'PARTIAL' ? '⚠️' : '❌';
    vscode.window.showInformationMessage(
        `${icon} 测试完成: ${testResult.passed_steps}/${testResult.total_steps} 通过 → ${outputPath}`
    );
}

/**
 * 执行单个步骤（手动模式）。
 */
async function runSingleStep(stepNumber: number, outputDir: string): Promise<void> {
    if (!currentPlan) {
        vscode.window.showWarningMessage('⚠️ 没有加载测试计划');
        return;
    }

    const step = currentPlan.steps.find(s => s.step_number === stepNumber);
    if (!step) {
        vscode.window.showErrorMessage(`❌ 找不到步骤 #${stepNumber}`);
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '/';
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const timeoutMs = config.get<number>('commandTimeout', 300000);

    const result = await executeStep(step, workspaceFolder, timeoutMs);
    stepResults.set(result.step_number, result);

    const icon = result.status === 'PASS' ? '✅' : '❌';
    vscode.window.showInformationMessage(
        `${icon} 步骤 #${step.step_number} "${step.title}": ${result.status} (exit=${result.exit_code})`
    );

    // 每次单步执行也增量更新 test_result.json
    const allResults = currentPlan.steps.map(s => {
        return stepResults.get(s.step_number) ?? {
            step_number: s.step_number,
            title: s.title,
            command: s.command,
            status: 'PENDING' as const,
            exit_code: null,
            duration_ms: 0,
            console_output: '',
        };
    });

    const testResult = buildTestResult(allResults, currentPlan.steps.length);
    const outputPath = path.join(outputDir, getResultFileName());
    await writeJson(outputPath, testResult);
    
    // Update registry status by recalculating
    updatePlanIdentifiers(currentPlan.model_id || '', currentPlan.prompt_id || '');
}

/**
 * 通过明确的步骤号执行（供 Webview 界面直接调用）。
 */
export async function runStepByNumber(stepNumber: number): Promise<void> {
    const outputPath = resolveOutputPath('results');
    await runSingleStep(stepNumber, outputPath);
}

/**
 * 从测试计划中删除指定步骤（供 Webview 界面调用）。
 */
export async function deleteStepFromPlan(stepNumber: number): Promise<void> {
    if (!currentPlan) return;
    
    currentPlan.steps = currentPlan.steps.filter(s => s.step_number !== stepNumber);
    stepResults.delete(stepNumber);
    
    const outputPath = resolveOutputPath('results');
    
    if (currentPlan.steps.length === 0 && (!currentPlan.check_items || currentPlan.check_items.length === 0)) {
        currentPlan = null;
    } else {
        const allResults = currentPlan.steps.map(s => {
            return stepResults.get(s.step_number) ?? {
                step_number: s.step_number,
                title: s.title,
                command: s.command,
                status: 'PENDING' as const,
                exit_code: null,
                duration_ms: 0,
                console_output: '',
            };
        });
        const testResult = buildTestResult(allResults, currentPlan.steps.length);
        const resultPath = path.join(outputPath, getResultFileName());
        // Ignore write error if it fails (e.g. dir doesn't exist)
        writeJson(resultPath, testResult).catch(() => {});
    }
    
    syncPlanToWebview();
}

/**
 * 重置所有测试结果（清空命令行输出，但保留测试计划和上下文）
 */
export async function resetStepResults(): Promise<void> {
    if (!currentPlan) return;
    
    // 清空结果
    stepResults.clear();
    
    // Update registry status to RUNNING
    pushSessionUpdate({ status: 'RUNNING', model_id: currentPlan.model_id, prompt_id: currentPlan.prompt_id });

    // 生成 PENDING 状态的新 test_result.json
    const outputPath = resolveOutputPath('results');
    
    const allResults = currentPlan.steps.map(s => ({
        step_number: s.step_number,
        title: s.title,
        command: s.command,
        status: 'PENDING' as const,
        exit_code: null,
        duration_ms: 0,
        console_output: '',
    }));
    
    const testResult = buildTestResult(allResults, currentPlan.steps.length);
    const resultPath = path.join(outputPath, getResultFileName());
    writeJson(resultPath, testResult).catch(() => {});
    
    syncPlanToWebview();
}


/**
 * 手动添加步骤
 */
export function addStepToPlan(title: string, command: string): void {
    if (!currentPlan) {
        currentPlan = { steps: [], check_items: [] };
    }
    const nextStepNumber = currentPlan.steps.length > 0 
        ? Math.max(...currentPlan.steps.map(s => s.step_number)) + 1 
        : 1;
    
    currentPlan.steps.push({
        step_number: nextStepNumber,
        title,
        command
    });
    syncPlanToWebview();
}

/**
 * 手动添加检查项
 */
export function addCheckItemToPlan(item: string): void {
    if (!currentPlan) {
        currentPlan = { steps: [], check_items: [] };
    }
    if (!currentPlan.check_items) {
        currentPlan.check_items = [];
    }
    currentPlan.check_items.push({ text: item, passed: false });
    syncPlanToWebview();
}

/**
 * 切换检查项状态
 */
export function toggleCheckItemInPlan(index: number, passed: boolean): void {
    if (!currentPlan || !currentPlan.check_items) return;
    if (index >= 0 && index < currentPlan.check_items.length) {
        currentPlan.check_items[index].passed = passed;
        // 注意：不调用 syncPlanToWebview() 避免打断前端 UI 焦点，因为这是前端主动推过来的状态
    }
}

/**
 * 删除指定索引的检查项
 */
export function removeCheckItemFromPlan(index: number): void {
    if (!currentPlan || !currentPlan.check_items) return;
    if (index >= 0 && index < currentPlan.check_items.length) {
        currentPlan.check_items.splice(index, 1);
        syncPlanToWebview();
    }
}

/**
 * 导出当前计划为 JSON 到剪贴板
 */
export async function copyPlanToJson(): Promise<void> {
    if (!currentPlan) {
        vscode.window.showWarningMessage('⚠️ 当前没有测试计划可导出');
        return;
    }
    const jsonStr = JSON.stringify(currentPlan, null, 2);
    await vscode.env.clipboard.writeText(jsonStr);
    vscode.window.showInformationMessage('✅ 测试计划已成功复制为 JSON！');
}

/**
 * 供 MCP 调用的直接导入测试计划 JSON 字符串
 */
export function importTestPlanJson(jsonText: string): void {
    const newPlan = parseTestPlan(jsonText);
    currentPlan = newPlan;
    stepResults.clear();

    const log = getLogger();
    log.separator('MCP 测试计划已加载');
    log.info('TestRunner', `共解析 ${currentPlan.steps.length} 个步骤`);
    for (const step of currentPlan.steps) {
        log.detail(`#${step.step_number} ${step.title}`, step.command);
    }

    // 通知 Webview 更新步骤列表
    syncPlanToWebview();
}

/**
 * 供 MCP 调用的获取全量测试结果（用于组装 evidence）
 */
export function getTestResultsForEvidence(): TestResult | null {
    if (!currentPlan) return null;
    const allResults = currentPlan.steps.map(s => {
        return stepResults.get(s.step_number) ?? {
            step_number: s.step_number,
            title: s.title,
            command: s.command,
            status: 'PENDING' as const,
            exit_code: null,
            duration_ms: 0,
            console_output: '',
        };
    });
    return buildTestResult(allResults, currentPlan.steps.length);
}

/**
 * 注册所有测试相关命令。
 */
export function registerTestCommands(context: vscode.ExtensionContext): vscode.Disposable[] {
    const config = vscode.workspace.getConfiguration('traeHarvester');

    // 命令：输入测试步骤 JSON
    const inputCmd = vscode.commands.registerCommand('trae-harvester.inputTestSteps', async () => {
        try {
            const jsonText = await vscode.window.showInputBox({
                title: '输入测试步骤 JSON',
                prompt: '粘贴由 AI 生成的测试步骤 JSON (格式: {"steps": [...]})',
                placeHolder: '{"steps": [{"step_number": 1, "title": "运行测试", "command": "npm run test"}]}',
                ignoreFocusOut: true,
            });

            if (!jsonText) {
                return; // 用户取消
            }

            currentPlan = parseTestPlan(jsonText);
            stepResults.clear();

            const log = getLogger();
            log.separator('测试计划已加载');
            log.info('TestRunner', `共解析 ${currentPlan.steps.length} 个步骤`);
            for (const step of currentPlan.steps) {
                log.detail(`#${step.step_number} ${step.title}`, step.command);
            }

            // 通知 Webview 更新步骤列表
            syncPlanToWebview();

            vscode.window.showInformationMessage(
                `📋 已加载 ${currentPlan.steps.length} 个测试步骤，请在侧边栏查看`
            );
        } catch (err: any) {
            getLogger().error('TestRunner', '测试步骤解析失败', err);
            vscode.window.showErrorMessage(`❌ 测试步骤解析失败: ${err.message}`);
        }
    });

    // 命令：一键全自动执行
    const runAllCmd = vscode.commands.registerCommand('trae-harvester.runAllTests', async () => {
        try {
            const outputPath = resolveOutputPath('results');
            await runAllSteps(outputPath);
        } catch (err: any) {
            getLogger().error('TestRunner', '测试执行失败', err);
            getLogger().setError('测试执行失败');
            vscode.window.showErrorMessage(`❌ 测试执行失败: ${err.message}`);
        }
    });

    // 命令：单步执行
    const runStepCmd = vscode.commands.registerCommand('trae-harvester.runSingleStep', async () => {
        try {
            if (!currentPlan || currentPlan.steps.length === 0) {
                vscode.window.showWarningMessage('⚠️ 没有加载测试计划');
                return;
            }

            // 让用户选择要执行的步骤
            const items = currentPlan.steps.map(s => {
                const existing = stepResults.get(s.step_number);
                const statusIcon = existing
                    ? (existing.status === 'PASS' ? '✅' : existing.status === 'FAIL' ? '❌' : '⏳')
                    : '⬜';
                return {
                    label: `${statusIcon} #${s.step_number}: ${s.title}`,
                    description: s.command,
                    stepNumber: s.step_number,
                };
            });

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: '选择要执行的测试步骤',
            });

            if (!selected) {
                return;
            }

            const outputPath = resolveOutputPath('results');
            await runSingleStep(selected.stepNumber, outputPath);
        } catch (err: any) {
            vscode.window.showErrorMessage(`❌ 单步执行失败: ${err.message}`);
        }
    });

    // 命令：导出测试结果
    const exportResultsCmd = vscode.commands.registerCommand('trae-harvester.exportResults', async () => {
        try {
            if (!currentPlan) {
                vscode.window.showWarningMessage('⚠️ 当前没有可导出的测试结果');
                return;
            }
            const allResults = currentPlan.steps.map(s => {
                return stepResults.get(s.step_number) ?? {
                    step_number: s.step_number,
                    title: s.title,
                    command: s.command,
                    status: 'PENDING' as const,
                    exit_code: null,
                    duration_ms: 0,
                    console_output: '',
                };
            });
            const testResult = buildTestResult(allResults, currentPlan.steps.length);
            
            const defaultDir = resolveOutputPath('results');
            
            const targetPath = path.join(defaultDir, getResultFileName());
            
            await writeJson(targetPath, testResult);
            vscode.window.showInformationMessage(`✅ 测试结果已成功导出至: ${targetPath}`);
        } catch (err: any) {
            getLogger().error('TestRunner', '测试结果导出失败', err);
            vscode.window.showErrorMessage(`❌ 测试结果导出失败: ${err.message}`);
        }
    });

    return [inputCmd, runAllCmd, runStepCmd, exportResultsCmd];
}
