// ============================================================
// Trae Harvester — 扩展主入口 (Extension Entry Point)
// ============================================================
// 注册所有命令、侧边栏 Webview Provider，并管理扩展生命周期。

import * as vscode from 'vscode';
import { registerExportPatchCommand } from './commands/gitPatch';
import { registerTestCommands } from './commands/testRunner';
import { registerDiagnosticsCommands } from './commands/diagnostics';
import { TestPanelProvider } from './providers/testPanelProvider';
import { getLogger } from './utils/logger';
import { startMcpServer, stopMcpServer } from './mcp/mcpServer';
import { checkForUpdates } from './utils/autoUpdater';

/**
 * 扩展激活时调用。
 * VS Code 会在用户首次触发本扩展注册的命令或视图时调用此函数。
 */
export function activate(context: vscode.ExtensionContext) {
    // ---- 初始化统一日志系统 ----
    const log = getLogger();
    log.separator('Trae Harvester 扩展激活');
    log.info('Extension', `扩展路径: ${context.extensionPath}`);
    log.info('Extension', `远程环境: ${vscode.env.remoteName || '本地'}`);
    log.info('Extension', `VS Code 版本: ${vscode.version}`);
    log.info('Extension', `Node 版本: ${process.version}`);

    // 将 Logger 的 channel 和 statusBar 加入 subscriptions 管理生命周期
    context.subscriptions.push(log.channel);
    context.subscriptions.push(log.statusBarItem);

    // ---- 注册功能一：Git Patch 导出 ----
    const patchCmd = registerExportPatchCommand(context);
    context.subscriptions.push(patchCmd);
    log.debug('Extension', '已注册命令: trae-harvester.exportPatch');

    // ---- 注册功能二：测试命令编排 ----
    const testCmds = registerTestCommands(context);
    testCmds.forEach(cmd => context.subscriptions.push(cmd));
    log.debug('Extension', '已注册命令: trae-harvester.inputTestSteps');
    log.debug('Extension', '已注册命令: trae-harvester.runAllTests');
    log.debug('Extension', '已注册命令: trae-harvester.runSingleStep');

    // AI Context feature has been removed as per user request.

    // ---- 注册侧边栏 Webview Provider ----
    const testPanelProvider = new TestPanelProvider(context.extensionUri);
    const panelRegistration = vscode.window.registerWebviewViewProvider(
        TestPanelProvider.viewType,
        testPanelProvider
    );
    context.subscriptions.push(panelRegistration);
    log.debug('Extension', '已注册侧边栏: trae-harvester.testPanel');

    // ---- 启动 MCP Server ----
    startMcpServer();

    // ---- 注册一键执行所有功能的快捷命令（可选） ----
    const harvestAllCmd = vscode.commands.registerCommand(
        'trae-harvester.harvestAll',
        async () => {
            try {
                log.separator('一键收割所有产物');

                // 依次执行三大功能
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: 'Trae Harvester: 收割中...',
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ message: '导出 Git Patch...', increment: 0 });
                        try {
                            await vscode.commands.executeCommand('trae-harvester.exportPatch');
                        } catch (err: any) {
                            log.error('HarvestAll', 'Patch 导出失败', err);
                        }

                        progress.report({ message: '执行测试...', increment: 33 });
                        try {
                            await vscode.commands.executeCommand('trae-harvester.runAllTests');
                        } catch (err: any) {
                            log.error('HarvestAll', '测试执行失败', err);
                        }

                        // AI Context feature has been removed.

                        progress.report({ message: '完成!', increment: 100 });
                    }
                );

                const config = vscode.workspace.getConfiguration('traeHarvester');
                const outputPath = config.get<string>('outputPath', '/gitdiff_shared');
                vscode.window.showInformationMessage(
                    `🎉 收割完成! 产物目录: ${outputPath}`
                );
            } catch (err: any) {
                vscode.window.showErrorMessage(`❌ 收割失败: ${err.message}`);
            }
        }
    );
    context.subscriptions.push(harvestAllCmd);
    log.debug('Extension', '已注册命令: trae-harvester.harvestAll');

    // ---- 注册诊断命令 ----
    const diagCmds = registerDiagnosticsCommands(context);
    diagCmds.forEach((cmd: vscode.Disposable) => context.subscriptions.push(cmd));
    log.debug('Extension', '已注册命令: trae-harvester.runDiagnostics');
    log.debug('Extension', '已注册命令: trae-harvester.showLogs');

    const checkUpdatesCmd = vscode.commands.registerCommand(
        'trae-harvester.checkForUpdates',
        () => {
            checkForUpdates(context, true);
        }
    );
    context.subscriptions.push(checkUpdatesCmd);

    // ---- 显示欢迎信息 ----
    log.info('Extension', '🚀 Trae Harvester 初始化完成!');
    log.info('Extension', '可用命令: exportPatch / inputTestSteps / runAllTests / runSingleStep / harvestAll / runDiagnostics');
    log.info('Extension', '💡 提示: 执行 "Trae Harvester: Run Diagnostics" 可一键检查运行环境');

    // ---- 检查更新 ----
    checkForUpdates(context);

    log.setSuccess('已就绪');
}

/**
 * 扩展停用时调用。
 * 清理资源（subscriptions 会自动 dispose）。
 */
export function deactivate() {
    try {
        stopMcpServer();
        getLogger().info('Extension', '扩展已停用');
    } catch {
        // Logger may already be disposed
    }
}
