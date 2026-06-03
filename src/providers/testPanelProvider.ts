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

        if (plan && this._view) {
            this._view.webview.postMessage({
                command: 'loadSteps',
                steps: plan.steps,
                checkItems: plan.check_items || [],
                isMcpRunning
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
                isMcpRunning
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
    <div class="container">
        <div class="header" style="margin-bottom: var(--spacing-sm);">
            <h2>🎛️ Harvester 工具箱</h2>
            <div class="actions" style="margin-bottom: 8px;">
                <button id="btn-toggle-mcp" class="btn btn-secondary" title="开启或关闭 MCP Server (供大模型连接)">
                    🔴 启动 MCP
                </button>
                <button id="btn-open-settings" class="btn btn-secondary" title="配置插件参数">
                    ⚙️ 插件设置
                </button>
                <button id="btn-check-updates" class="btn btn-secondary" title="检查并安装最新版本">
                    🔄 检查更新
                </button>
                <button id="btn-clear-all" class="btn btn-secondary" title="一键清除当前测试计划、结果和上下文" style="color: var(--vscode-errorForeground);">
                    🗑️ 全部清除
                </button>
            </div>
            <div class="actions">
                <button id="btn-export-patch" class="btn btn-secondary" title="一键导出 Git Patch">
                    📦 导出 Patch
                </button>
                <button id="btn-export-logs" class="btn btn-secondary" title="一键导出插件运行调试日志">
                    📝 导出调试日志
                </button>
                <button id="btn-export-results" class="btn btn-secondary" title="一键导出测试执行结果及验收项">
                    📊 导出测试结果
                </button>
            </div>
        </div>

        <div class="steps-container">
            <h2>📋 测试编排与执行</h2>
            <div class="actions" style="margin-bottom: var(--spacing-sm);">
                <button id="btn-show-add-menu" class="btn btn-secondary" title="添加或导入用例">
                    ➕ 添加...
                </button>
                <button id="btn-copy-json" class="btn btn-secondary" title="将当前用例复制为 JSON 文本">
                    📑 复制 JSON
                </button>
                <button id="btn-reset-results" class="btn btn-secondary" title="重置当前所有测试的执行状态和终端输出">
                    🔄 重置状态
                </button>
                <button id="btn-run-all" class="btn btn-primary" title="一键执行所有步骤" disabled>
                    ▶ 全部执行
                </button>
            </div>

            <!-- 子菜单 -->
            <div id="sub-menu-add" class="sub-menu-panel" style="display: none;">
                <button class="btn-close" id="btn-close-sub-menu" title="关闭">×</button>
                <div class="sub-menu-items">
                    <button id="btn-input" class="btn btn-secondary">📥 从 JSON 导入</button>
                    <button id="btn-show-add-step" class="btn btn-secondary">📝 添加测试命令</button>
                    <button id="btn-show-add-check" class="btn btn-secondary">📋 添加检查项</button>
                </div>
            </div>

            <!-- 添加命令面板 -->
            <div id="panel-add-step" class="input-panel" style="display: none;">
                <button class="btn-close" id="btn-close-add-step" title="关闭">×</button>
                <div class="section-title">添加测试命令</div>
                <div class="form-group">
                    <input type="text" id="input-step-title" class="input-field" placeholder="步骤描述 (如: 运行测试)" />
                    <input type="text" id="input-step-command" class="input-field" placeholder="执行命令 (如: npm run test)" />
                    <button id="btn-add-step" class="btn btn-secondary">确认添加</button>
                </div>
            </div>

            <!-- 添加检查项面板 -->
            <div id="panel-add-check" class="input-panel" style="display: none;">
                <button class="btn-close" id="btn-close-add-check" title="关闭">×</button>
                <div class="section-title">添加验收检查项</div>
                <div class="form-group">
                    <input type="text" id="input-check-item" class="input-field" placeholder="新增检查项..." />
                    <button id="btn-add-check" class="btn btn-secondary">确认添加</button>
                </div>
            </div>

        </div>

        <div id="empty-state" class="empty-state">
            <p>暂无测试步骤</p>
            <p class="hint">点击"📥 输入"按钮粘贴 AI 生成的测试步骤 JSON</p>
        </div>

        <div id="steps-list" class="steps-list" style="display: none;"></div>

        <div id="summary" class="summary" style="display: none;">
            <div class="summary-bar">
                <span id="summary-icon">📊</span>
                <span id="summary-text">等待执行...</span>
            </div>
        </div>

        <!-- 检查项列表 -->
        <div class="check-items-section" id="check-items-section" style="display: none; margin-top: var(--spacing-sm);">
            <div class="section-title">验收检查项</div>
            <div id="check-items-list" class="check-items-list">
                <!-- 检查项将由 JS 动态渲染 -->
            </div>
        </div>
        
        <div class="ai-context-container" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--vscode-panel-border);">
            <h3 style="margin-top: 0; margin-bottom: 8px;">🧠 AI 思考上下文</h3>
            <textarea id="input-ai-context" rows="4" style="width: 100%; resize: vertical; margin-bottom: 8px; font-family: var(--vscode-font-family); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 4px;" placeholder="在这里粘贴 AI 生成的思考上下文或对话记录..."></textarea>
            <button id="btn-save-ai-context" class="btn btn-primary" style="width: 100%;">📝 保存 AI 上下文</button>
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
