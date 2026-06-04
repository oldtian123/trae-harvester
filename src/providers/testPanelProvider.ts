// ============================================================
// Trae Harvester — 侧边栏 Webview 面板 (Test Steps Panel)
// ============================================================
// 可视化渲染测试步骤列表，提供单步/全自动执行按钮，
// 通过 postMessage 与 extension 主进程通信。

import * as vscode from 'vscode';
import { setWebviewRef, getCurrentPlan, getStepResults } from '../commands/testRunner';

export class TestPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'trae-harvester.testPanel';

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    /**
     * VS Code 调用此方法来初始化 Webview 视图。
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri],
        };

        webviewView.webview.html = this._getHtmlContent(webviewView.webview);

        // 设置 Webview 引用供 testRunner 使用
        setWebviewRef(webviewView.webview);

        // 处理来自 Webview 的消息
        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                        // Webview 加载完毕，发送当前状态
                        this._syncCurrentState();
                        break;
                    case 'runAll':
                        await vscode.commands.executeCommand('trae-harvester.runAllTests');
                        break;
                    case 'runStep':
                        // 执行特定步骤
                        if (message.stepNumber !== undefined) {
                            const { runStepByNumber } = require('../commands/testRunner');
                            await runStepByNumber(message.stepNumber);
                        }
                        break;
                    case 'deleteStep':
                        // 删除特定步骤
                        if (message.stepNumber !== undefined) {
                            const { deleteStepFromPlan } = require('../commands/testRunner');
                            await deleteStepFromPlan(message.stepNumber);
                        }
                        break;
                    case 'inputSteps':
                        await vscode.commands.executeCommand('trae-harvester.inputTestSteps');
                        break;
                    case 'exportPatch':
                        await vscode.commands.executeCommand('trae-harvester.exportPatch');
                        break;
                    case 'exportLogs':
                        await vscode.commands.executeCommand('trae-harvester.exportLogs');
                        break;
                    case 'exportResults':
                        await vscode.commands.executeCommand('trae-harvester.exportResults');
                        break;
                    case 'addStep':
                        if (message.title && message.commandToRun) {
                            const { addStepToPlan } = require('../commands/testRunner');
                            addStepToPlan(message.title, message.commandToRun);
                        }
                        break;
                    case 'addCheckItem':
                        if (message.item) {
                            const { addCheckItemToPlan } = require('../commands/testRunner');
                            addCheckItemToPlan(message.item);
                        }
                        break;
                    case 'removeCheckItem':
                        if (message.index !== undefined) {
                            const { removeCheckItemFromPlan } = require('../commands/testRunner');
                            removeCheckItemFromPlan(message.index);
                        }
                        break;
                    case 'toggleCheckItem':
                        if (message.index !== undefined && message.passed !== undefined) {
                            const { toggleCheckItemInPlan } = require('../commands/testRunner');
                            toggleCheckItemInPlan(message.index, message.passed);
                        }
                        break;
                    case 'copyJson':
                        const { copyPlanToJson } = require('../commands/testRunner');
                        await copyPlanToJson();
                        break;
                    case 'toggleMcp':
                        const { isMcpServerRunning, startMcpServer, stopMcpServer } = require('../mcp/mcpServer');
                        if (isMcpServerRunning()) {
                            stopMcpServer();
                        } else {
                            startMcpServer();
                        }
                        this._syncCurrentState();
                        break;
                    case 'openSettings':
                        await vscode.commands.executeCommand('workbench.action.openSettings', 'traeHarvester');
                        break;
                    case 'saveAiContext':
                        const { setAiContext } = require('../commands/testRunner');
                        if (message.text !== undefined) {
                            setAiContext(message.text);
                            vscode.window.showInformationMessage('✅ AI 思考上下文已保存');
                        }
                        break;
                    case 'resetResults':
                        const { resetStepResults } = require('../commands/testRunner');
                        await resetStepResults();
                        vscode.window.showInformationMessage('🔄 测试执行结果已重置');
                        break;
                    case 'clearAll':
                        const { clearAllState } = require('../commands/testRunner');
                        clearAllState();
                        vscode.window.showInformationMessage('🗑️ 已清除所有上下文和测试结果');
                        break;
                    case 'checkUpdates':
                        await vscode.commands.executeCommand('trae-harvester.checkForUpdates');
                        break;
                    case 'showGlobalStatus':
                        await vscode.commands.executeCommand('trae-harvester.showGlobalStatus');
                        break;
                    case 'updateIdentifiers':
                        const { updatePlanIdentifiers } = require('../commands/testRunner');
                        updatePlanIdentifiers(message.modelId, message.promptId);
                        break;
                }
            },
            undefined,
            []
        );

        // 当 Webview 被销毁时清除引用
        webviewView.onDidDispose(() => {
            setWebviewRef(null);
        });
    }

    /**
     * 同步当前测试计划和结果到 Webview。
     */
    private _syncCurrentState(): void {
        const plan = getCurrentPlan();
        const { isMcpServerRunning } = require('../mcp/mcpServer');
        const isMcpRunning = isMcpServerRunning();

        const config = vscode.workspace.getConfiguration('traeHarvester');
        const modelOptions = config.get<string[]>('modelOptions') || [];
        const promptOptions = config.get<string[]>('promptOptions') || [];

        if (plan && this._view) {
            this._view.webview.postMessage({
                command: 'loadSteps',
                steps: plan.steps,
                checkItems: plan.check_items || [],
                isMcpRunning,
                modelOptions,
                promptOptions,
                modelId: plan.model_id || '',
                promptId: plan.prompt_id || ''
            });

            // 同步已有的执行结果
            const results = getStepResults();
            for (const [stepNumber, result] of results) {
                this._view.webview.postMessage({
                    command: 'stepCompleted',
                    stepNumber,
                    result,
                });
            }
        } else if (this._view) {
            this._view.webview.postMessage({
                command: 'loadSteps',
                steps: [],
                checkItems: [],
                isMcpRunning,
                modelOptions,
                promptOptions,
                modelId: '',
                promptId: ''
            });
        }
    }

    /**
     * 生成 Webview 的 HTML 内容。
     */
    private _getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'testPanel.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'testPanel.css')
        );

        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Test Steps</title>
</head>
<body>
    <!-- Toast Container (Absolute within sidebar) -->
    <div id="toast-container"></div>

    <div class="container">
        <!-- Global Tools Card -->
        <div class="section-card">
            <div class="section-header">
                <span>🎛️ Harvester 工具箱</span>
            </div>

            <!-- Identifiers Section -->
            <div style="display: flex; gap: var(--spacing-sm); margin-bottom: var(--spacing-sm);">
                <div style="flex: 1;">
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">测试模型 (Model)</label>
                    <select id="select-model" class="form-select" style="width: 100%; padding: 4px; border: 1px solid var(--card-border); border-radius: 4px; background: var(--card-bg); color: var(--text-primary);"></select>
                </div>
                <div style="flex: 1;">
                    <label style="font-size: 11px; color: var(--text-secondary); display: block; margin-bottom: 4px;">测试提示词 (Prompt)</label>
                    <select id="select-prompt" class="form-select" style="width: 100%; padding: 4px; border: 1px solid var(--card-border); border-radius: 4px; background: var(--card-bg); color: var(--text-primary);"></select>
                </div>
            </div>
            
            <div class="actions-grid">
                <button id="btn-toggle-mcp" class="btn btn-secondary" title="开启或关闭 MCP Server (供大模型连接)">
                    <span class="icon-normal">🔴</span>
                    <span class="spinner"></span>
                    <span class="btn-text">启动 MCP</span>
                </button>
                <button id="btn-show-global-status" class="btn btn-secondary" title="在终端中打开全局多窗口状态大屏">
                    <span class="icon-normal">📊</span>
                    <span class="spinner"></span>
                    <span class="btn-text">状态大屏</span>
                </button>
                <button id="btn-check-updates" class="btn btn-secondary" title="检查并安装最新版本">
                    <span class="icon-normal">🔄</span>
                    <span class="spinner"></span>
                    <span class="btn-text">检查更新</span>
                </button>
                <button id="btn-open-settings" class="btn btn-secondary" title="配置插件参数">
                    <span class="icon-normal">⚙️</span>
                    <span class="spinner"></span>
                    <span class="btn-text">插件设置</span>
                </button>
                <button id="btn-clear-all" class="btn btn-danger" title="一键清除当前测试计划、结果和上下文" style="grid-column: 1 / -1;">
                    <span class="icon-normal">🗑️</span>
                    <span class="spinner"></span>
                    <span class="btn-text">全部清除</span>
                </button>
            </div>
            
            <div style="margin-top: var(--spacing-sm); height: 1px; background: var(--card-border);"></div>
            
            <div class="actions-grid full" style="margin-top: var(--spacing-sm);">
                <button id="btn-export-patch" class="btn btn-secondary" title="一键导出 Git Patch">
                    <span class="icon-normal">📦</span>
                    <span class="spinner"></span>
                    <span class="btn-text">导出 Patch</span>
                </button>
                <button id="btn-export-logs" class="btn btn-secondary" title="一键导出插件运行调试日志">
                    <span class="icon-normal">📝</span>
                    <span class="spinner"></span>
                    <span class="btn-text">导出调试日志</span>
                </button>
                <button id="btn-export-results" class="btn btn-secondary" title="一键导出测试执行结果及验收项">
                    <span class="icon-normal">📊</span>
                    <span class="spinner"></span>
                    <span class="btn-text">导出测试结果</span>
                </button>
            </div>
        </div>

        <!-- Test Execution Card -->
        <div class="section-card">
            <div class="section-header">
                <span>📋 测试编排与执行</span>
            </div>
            
            <div class="actions-grid">
                <button id="btn-show-add-menu" class="btn btn-secondary" title="添加或导入用例">
                    <span class="icon-normal">➕</span>
                    <span class="btn-text">添加...</span>
                </button>
                <button id="btn-copy-json" class="btn btn-secondary" title="将当前用例复制为 JSON 文本">
                    <span class="icon-normal">📑</span>
                    <span class="spinner"></span>
                    <span class="btn-text">复制 JSON</span>
                </button>
                <button id="btn-reset-results" class="btn btn-secondary" title="重置当前所有测试的执行状态和终端输出">
                    <span class="icon-normal">🔄</span>
                    <span class="spinner"></span>
                    <span class="btn-text">重置状态</span>
                </button>
            </div>

            <!-- 1. 子菜单面板 (Sub Menu) -->
            <div id="sub-menu-add" class="panel-container">
                <div class="panel-header">选择操作 <span class="panel-close" id="btn-close-sub-menu" title="关闭">✖</span></div>
                <div class="actions-grid full" style="gap: 4px;">
                    <button id="btn-input" class="btn btn-secondary" style="justify-content: flex-start">
                        <span class="icon-normal">📥</span>
                        <span class="spinner"></span>
                        <span class="btn-text">从 JSON 导入</span>
                    </button>
                    <button id="btn-show-add-step" class="btn btn-secondary" style="justify-content: flex-start">
                        <span class="icon-normal">📝</span>
                        <span class="btn-text">添加测试命令</span>
                    </button>
                    <button id="btn-show-add-check" class="btn btn-secondary" style="justify-content: flex-start">
                        <span class="icon-normal">📋</span>
                        <span class="btn-text">添加检查项</span>
                    </button>
                </div>
            </div>

            <!-- 2. 添加命令面板 -->
            <div id="panel-add-step" class="panel-container">
                <div class="panel-header">添加测试命令 <span class="panel-close" id="btn-close-add-step" title="关闭">✖</span></div>
                <input type="text" id="input-step-title" class="input-field" placeholder="步骤标题">
                <input type="text" id="input-step-command" class="input-field" placeholder="执行命令 (如 npm run test)">
                <button id="btn-add-step" class="btn btn-primary" style="width: 100%">添加指令</button>
            </div>

            <!-- 3. 添加检查项面板 -->
            <div id="panel-add-check" class="panel-container">
                <div class="panel-header">添加人工检查项 <span class="panel-close" id="btn-close-add-check" title="关闭">✖</span></div>
                <input type="text" id="input-check-item" class="input-field" placeholder="检查项内容">
                <button id="btn-add-check" class="btn btn-primary" style="width: 100%">添加检查项</button>
            </div>

            <div class="actions-grid full" style="margin-top: var(--spacing-sm);">
                <button id="btn-run-all" class="btn btn-primary" title="一键执行所有步骤" disabled>
                    <span class="icon-normal">▶</span>
                    <span class="spinner"></span>
                    <span class="btn-text">全部执行</span>
                </button>
            </div>

            <!-- Summary & Check Items & Steps List -->
            <div id="summary" class="summary" style="display: none; margin-top: var(--spacing-sm);">
                <span id="summary-icon"></span>
                <span id="summary-text" style="font-weight: 600;"></span>
            </div>

            <div id="empty-state" class="empty-state" style="margin-top: 30px;">
                <div style="font-size: 24px; margin-bottom: 8px;">📭</div>
                <div>暂无测试步骤</div>
                <div class="hint">点上方添加或 MCP 导入</div>
            </div>

            <div id="steps-list" class="steps-list" style="margin-top: var(--spacing-sm);"></div>

            <!-- 检查项列表 -->
            <div id="check-items-section" class="check-items-section" style="display: none; margin-top: var(--spacing-sm);">
                <div class="section-header" style="margin-bottom: 8px;">✅ 人工检查项</div>
                <div id="check-items-list"></div>
            </div>
        </div>

        <!-- AI Context Card -->
        <div class="section-card">
            <div class="section-header">
                <span>🧠 AI 思考上下文 (Evidence)</span>
            </div>
            <textarea id="input-ai-context" class="input-field" rows="4" placeholder="将 AI 生成的思考过程或代码分析粘贴在这里..." style="resize: vertical;"></textarea>
            <div class="actions-grid full" style="margin-top: 4px;">
                <button id="btn-save-ai-context" class="btn btn-primary">
                    <span class="icon-normal">💾</span>
                    <span class="spinner"></span>
                    <span class="btn-text">保存上下文</span>
                </button>
            </div>
        </div>
    </div>
    
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

/**
 * 生成随机 nonce 用于 CSP。
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
