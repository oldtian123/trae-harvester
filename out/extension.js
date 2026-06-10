"use strict";
// ============================================================
// Trae Harvester — 扩展主入口 (Extension Entry Point)
// ============================================================
// 注册所有命令、侧边栏 Webview Provider，并管理扩展生命周期。
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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const gitPatch_1 = require("./commands/gitPatch");
const testRunner_1 = require("./commands/testRunner");
const diagnostics_1 = require("./commands/diagnostics");
const testPanelProvider_1 = require("./providers/testPanelProvider");
const logger_1 = require("./utils/logger");
const windowServer_1 = require("./hub/windowServer");
const autoUpdater_1 = require("./utils/autoUpdater");
const path = __importStar(require("path"));
const pathResolver_1 = require("./utils/pathResolver");
/**
 * 扩展激活时调用。
 * VS Code 会在用户首次触发本扩展注册的命令或视图时调用此函数。
 */
function activate(context) {
    // ---- 初始化统一日志系统 ----
    const log = (0, logger_1.getLogger)();
    log.separator('Trae Harvester 扩展激活');
    log.info('Extension', `扩展路径: ${context.extensionPath}`);
    log.info('Extension', `远程环境: ${vscode.env.remoteName || '本地'}`);
    log.info('Extension', `VS Code 版本: ${vscode.version}`);
    log.info('Extension', `Node 版本: ${process.version}`);
    // 将 Logger 的 channel 和 statusBar 加入 subscriptions 管理生命周期
    context.subscriptions.push(log.channel);
    context.subscriptions.push(log.statusBarItem);
    // ---- 注册功能一：Git Patch 导出 ----
    const patchCmd = (0, gitPatch_1.registerExportPatchCommand)(context);
    context.subscriptions.push(patchCmd);
    log.debug('Extension', '已注册命令: trae-harvester.exportPatch');
    // ---- Git Fetch 命令 ----
    const gitFetchCmd = vscode.commands.registerCommand('trae-harvester.gitFetch', async () => {
        const { gitFetch } = require('./commands/gitPatch');
        await gitFetch();
    });
    context.subscriptions.push(gitFetchCmd);
    log.debug('Extension', '已注册命令: trae-harvester.gitFetch');
    // ---- 注册功能二：测试命令编排 ----
    const testCmds = (0, testRunner_1.registerTestCommands)(context);
    testCmds.forEach(cmd => context.subscriptions.push(cmd));
    log.debug('Extension', '已注册命令: trae-harvester.inputTestSteps');
    log.debug('Extension', '已注册命令: trae-harvester.runAllTests');
    log.debug('Extension', '已注册命令: trae-harvester.runSingleStep');
    // AI Context feature has been removed as per user request.
    // ---- 注册侧边栏 Webview Provider ----
    const testPanelProvider = new testPanelProvider_1.TestPanelProvider(context.extensionUri, context);
    const panelRegistration = vscode.window.registerWebviewViewProvider(testPanelProvider_1.TestPanelProvider.viewType, testPanelProvider);
    context.subscriptions.push(panelRegistration);
    log.debug('Extension', '已注册侧边栏: trae-harvester.testPanel');
    // ---- 窗口 HTTP server 改为手动控制（通过侧边栏按钮） ----
    // 不再自动启动
    // ---- 注册一键执行所有功能的快捷命令（可选） ----
    const harvestAllCmd = vscode.commands.registerCommand('trae-harvester.harvestAll', async () => {
        try {
            log.separator('一键收割所有产物');
            // 依次执行三大功能
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Trae Harvester: 收割中...',
                cancellable: false,
            }, async (progress) => {
                progress.report({ message: '导出 Git Patch...', increment: 0 });
                try {
                    await vscode.commands.executeCommand('trae-harvester.exportPatch');
                }
                catch (err) {
                    log.error('HarvestAll', 'Patch 导出失败', err);
                }
                progress.report({ message: '执行测试...', increment: 33 });
                try {
                    await vscode.commands.executeCommand('trae-harvester.runAllTests');
                }
                catch (err) {
                    log.error('HarvestAll', '测试执行失败', err);
                }
                // AI Context feature has been removed.
                progress.report({ message: '完成!', increment: 100 });
            });
            const patchPath = (0, pathResolver_1.resolveOutputPath)('patch');
            const resultsPath = (0, pathResolver_1.resolveOutputPath)('results');
            vscode.window.showInformationMessage(`🎉 收割完成! Patch目录: ${patchPath} | 结果目录: ${resultsPath}`);
        }
        catch (err) {
            vscode.window.showErrorMessage(`❌ 收割失败: ${err.message}`);
        }
    });
    context.subscriptions.push(harvestAllCmd);
    log.debug('Extension', '已注册命令: trae-harvester.harvestAll');
    // ---- 注册诊断命令 ----
    const diagCmds = (0, diagnostics_1.registerDiagnosticsCommands)(context);
    diagCmds.forEach((cmd) => context.subscriptions.push(cmd));
    log.debug('Extension', '已注册命令: trae-harvester.runDiagnostics');
    log.debug('Extension', '已注册命令: trae-harvester.showLogs');
    context.subscriptions.push(vscode.commands.registerCommand('trae-harvester.checkForUpdates', () => {
        (0, autoUpdater_1.checkForUpdates)(context, true);
    }), vscode.commands.registerCommand('trae-harvester.copyRouterCommand', async () => {
        const bridgePath = path.join(context.extensionPath, 'out', 'hub', 'bridge.js');
        const stdioCommand = `node "${bridgePath}"`;
        // 读取 Hub 信息以提供 HTTP 端点
        const hubInfoPath = require('os').homedir() + '/.trae-harvester-hub.json';
        let httpEndpoint = 'Hub not running';
        let token = '';
        if (require('fs').existsSync(hubInfoPath)) {
            try {
                const hubInfo = JSON.parse(require('fs').readFileSync(hubInfoPath, 'utf-8'));
                httpEndpoint = `http://127.0.0.1:${hubInfo.port}/mcp`;
                token = hubInfo.token;
            }
            catch { }
        }
        const choice = await vscode.window.showQuickPick([
            { label: '$(terminal) Stdio Bridge (推荐)', description: '大模型运行 node 命令', value: 'stdio' },
            { label: '$(globe) HTTP Endpoint', description: '大模型直连 URL + Bearer', value: 'http' },
        ], { placeHolder: '选择大模型接入 Hub 的方式' });
        if (!choice)
            return;
        if (choice.value === 'stdio') {
            await vscode.env.clipboard.writeText(stdioCommand);
            vscode.window.showInformationMessage('✅ Stdio Bridge 命令已复制！粘贴到大模型 MCP command 配置。');
        }
        else {
            const httpConfig = `端点: ${httpEndpoint}\nAuthorization: Bearer ${token}`;
            await vscode.env.clipboard.writeText(httpConfig);
            vscode.window.showInformationMessage('✅ HTTP 端点与 token 已复制！配置到大模型 MCP 设置。');
        }
    }), vscode.commands.registerCommand('trae-harvester.showGlobalStatus', () => {
        const dashboardPath = path.join(context.extensionPath, 'out', 'hub', 'dashboard.js');
        const command = `node "${dashboardPath}"`;
        const terminalName = 'Harvester Global Status';
        let terminal = vscode.window.terminals.find(t => t.name === terminalName);
        if (terminal) {
            terminal.dispose(); // 重启以刷新控制台
        }
        terminal = vscode.window.createTerminal(terminalName);
        terminal.show();
        terminal.sendText(command);
    }));
    // ---- 显示欢迎信息 ----
    log.info('Extension', '🚀 Trae Harvester 初始化完成!');
    log.info('Extension', '可用命令: exportPatch / inputTestSteps / runAllTests / runSingleStep / harvestAll / runDiagnostics');
    log.info('Extension', '💡 提示: 执行 "Trae Harvester: Run Diagnostics" 可一键检查运行环境');
    // ---- 检查更新 ----
    (0, autoUpdater_1.checkForUpdates)(context);
    log.setSuccess('已就绪');
}
/**
 * 扩展停用时调用。
 * 清理资源（subscriptions 会自动 dispose）。
 */
function deactivate() {
    try {
        (0, windowServer_1.stopWindowServer)();
        (0, logger_1.getLogger)().info('Extension', '扩展已停用');
    }
    catch {
        // Logger may already be disposed
    }
}
//# sourceMappingURL=extension.js.map