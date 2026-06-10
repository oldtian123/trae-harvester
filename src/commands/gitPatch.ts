// ============================================================
// Trae Harvester — 功能一：一键导出 Git Patch
// ============================================================
// 数据流：获取分支名 → git add/commit/push → git diff main...HEAD → 写入 .patch
// 容错：工作区干净时跳过 commit/push，命令失败时继续生成 patch

import * as vscode from 'vscode';
import * as path from 'path';
import { execCommand } from '../utils/shell';
import { atomicWrite, ensureDir } from '../utils/fileUtils';
import { getLogger } from '../utils/logger';
import { resolveOutputPath } from '../utils/pathResolver';

let currentGitPatchContent: string = '';

export function getStoredGitPatchContent(): string {
    return currentGitPatchContent;
}

export async function getCurrentBranch(): Promise<string> {
    try {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) return 'unknown';

        const result = await execCommand('git rev-parse --abbrev-ref HEAD', { cwd });
        const branchName = result.stdout.trim();
        if (!branchName || branchName === 'unknown') return 'unknown';

        try {
            const checkRemote = await execCommand(`git rev-parse --verify origin/${branchName}`, { cwd });
            const isRemote = checkRemote.exitCode === 0;
            return `${branchName} (${isRemote ? '远程' : '本地'})`;
        } catch {
            return `${branchName} (本地)`;
        }
    } catch {
        return 'unknown';
    }
}

/**
 * 执行 git fetch 从远端拉取最新分支信息
 */
export async function gitFetch(): Promise<void> {
    const log = getLogger();
    try {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!cwd) {
            vscode.window.showErrorMessage('❌ 未打开工作区');
            return;
        }

        log.info('GitFetch', 'Executing git fetch...');
        await execCommand('git fetch --all', { cwd, timeout: 30000 });

        vscode.window.showInformationMessage('✅ Git Fetch 完成');
        log.info('GitFetch', 'Git fetch completed successfully');

        // 自动更新分支信息到 Hub
        try {
            const { pushSessionUpdate } = require('../hub/windowServer');
            const currentBranch = await getCurrentBranch();
            if (currentBranch && currentBranch !== 'unknown') {
                pushSessionUpdate({ branch: currentBranch });
                log.info('GitFetch', `Updated branch to Hub: ${currentBranch}`);
            }
        } catch (e: any) {
            log.warn('GitFetch', `Could not update branch to Hub: ${e.message}`);
        }
    } catch (err: any) {
        log.error('GitFetch', 'Git fetch failed', err);
        vscode.window.showErrorMessage(`❌ Git Fetch 失败: ${err?.message || err}`);
    }
}

/** Git 操作的每步日志 */
interface GitStepLog {
    step: string;
    command: string;
    success: boolean;
    stdout: string;
    stderr: string;
    exitCode: number | null;
    skipped?: boolean;
    skipReason?: string;
}

/**
 * 执行 Git Patch 导出的完整流程。
 * 
 * @param outputDir  产物输出目录的绝对路径
 * @returns          生成的 .patch 文件路径
 */
export async function exportGitPatch(outputDir: string): Promise<string> {
    const log = getLogger();
    log.separator('功能一：Git Patch 导出');
    log.timerStart('exportPatch');

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        log.error('GitPatch', '没有打开的工作区，无法执行 Git 操作');
        throw new Error('没有打开的工作区，无法执行 Git 操作');
    }

    log.info('GitPatch', `工作区目录: ${workspaceFolder}`);

    const logs: GitStepLog[] = [];
    const execOpts = { cwd: workspaceFolder };

    // ---- Step 1: 获取当前分支名 ----
    const branchResult = await execCommand('git rev-parse --abbrev-ref HEAD', execOpts);
    if (branchResult.exitCode !== 0 || !branchResult.stdout.trim()) {
        throw new Error(`无法获取当前分支名: ${branchResult.stderr}`);
    }
    const currentBranch = branchResult.stdout.trim();
    log.info('GitPatch', `当前分支: ${currentBranch}`);
    logs.push({
        step: '获取分支名',
        command: 'git rev-parse --abbrev-ref HEAD',
        success: true,
        stdout: branchResult.stdout,
        stderr: branchResult.stderr,
        exitCode: branchResult.exitCode,
    });

    vscode.window.showInformationMessage(`📌 当前分支: ${currentBranch}`);

    // ---- Step 1.5: 检查是否为远程分支 ----
    let isRemote = false;
    try {
        const checkRemoteResult = await execCommand(`git rev-parse --verify origin/${currentBranch}`, execOpts);
        isRemote = checkRemoteResult.exitCode === 0;
    } catch {
        isRemote = false;
    }
    log.info('GitPatch', `分支类型: ${isRemote ? '远程分支' : '本地分支'}`);

    // ---- Step 2: 检查工作区状态 ----
    const statusResult = await execCommand('git status --porcelain', execOpts);
    const isClean = statusResult.stdout.trim() === '';
    log.info('GitPatch', `工作区状态: ${isClean ? '干净 (无变动)' : '有未提交的变更'}`);
    logs.push({
        step: '检查工作区状态',
        command: 'git status --porcelain',
        success: statusResult.exitCode === 0,
        stdout: statusResult.stdout,
        stderr: statusResult.stderr,
        exitCode: statusResult.exitCode,
    });

    if (!isRemote) {
        log.info('GitPatch', '本地分支：跳过 add/commit/push，直接生成 diff');
        vscode.window.showInformationMessage('📂 本地分支：直接生成 Patch');

        // 添加跳过日志
        for (const step of ['git add .', 'git commit', 'git push']) {
            logs.push({
                step: `跳过: ${step}`,
                command: step,
                success: true,
                stdout: '',
                stderr: '',
                exitCode: null,
                skipped: true,
                skipReason: '本地分支无需推送',
            });
        }
    } else if (isClean) {
        vscode.window.showInformationMessage('📂 工作区干净，跳过 commit/push');
        
        // 添加跳过日志
        for (const step of ['git add .', 'git commit', 'git push']) {
            logs.push({
                step: `跳过: ${step}`,
                command: step,
                success: true,
                stdout: '',
                stderr: '',
                exitCode: null,
                skipped: true,
                skipReason: '工作区无变动',
            });
        }
    } else {
        // ---- Step 3: git add . ----
        log.subSeparator('git add .');
        const addResult = await execCommand('git add .', execOpts);
        log.detail('exitCode', String(addResult.exitCode));
        if (addResult.stderr) { log.detail('stderr', addResult.stderr.trim()); }
        logs.push({
            step: 'git add .',
            command: 'git add .',
            success: addResult.exitCode === 0,
            stdout: addResult.stdout,
            stderr: addResult.stderr,
            exitCode: addResult.exitCode,
        });

        if (addResult.exitCode !== 0) {
            vscode.window.showWarningMessage(`⚠️ git add 失败: ${addResult.stderr}`);
        }

        // ---- Step 4: git commit ----
        const commitMsg = `merge origin ${currentBranch}`;
        log.subSeparator(`git commit -m "${commitMsg}"`);
        const commitResult = await execCommand(
            `git commit -m "${commitMsg}"`,
            execOpts
        );
        logs.push({
            step: 'git commit',
            command: `git commit -m "${commitMsg}"`,
            success: commitResult.exitCode === 0,
            stdout: commitResult.stdout,
            stderr: commitResult.stderr,
            exitCode: commitResult.exitCode,
        });

        log.detail('exitCode', String(commitResult.exitCode));
        if (commitResult.stdout) { log.detail('stdout', commitResult.stdout.trim()); }
        if (commitResult.stderr) { log.detail('stderr', commitResult.stderr.trim()); }
        if (commitResult.exitCode !== 0) {
            // commit 失败（如 nothing to commit）不中断
            vscode.window.showWarningMessage(
                `⚠️ git commit 非零退出 (code=${commitResult.exitCode}): ${commitResult.stderr || commitResult.stdout}`
            );
        }

        // ---- Step 5: git push ----
        const configToken = vscode.workspace.getConfiguration('traeHarvester').get<string>('githubToken');
        const githubToken = configToken || process.env.GITHUB_TOKEN;
        
        let pushCommand = `git push origin ${currentBranch}`;
        let pushLogCommand = pushCommand;
        
        if (githubToken) {
            const urlResult = await execCommand('git remote get-url origin', execOpts);
            if (urlResult.exitCode === 0) {
                let remoteUrl = urlResult.stdout.trim();
                if (remoteUrl.startsWith('https://github.com')) {
                    const authUrl = remoteUrl.replace('https://github.com', `https://${githubToken}@github.com`);
                    pushCommand = `git push ${authUrl} ${currentBranch}`;
                    pushLogCommand = `git push https://***@github.com/... ${currentBranch}`;
                    log.info('GitPatch', '💡 检测到 GitHub Token，已自动注入到 Push URL 中进行鉴权');
                }
            }
        }

        log.subSeparator(pushLogCommand);
        const pushResult = await execCommand(
            pushCommand,
            execOpts
        );
        logs.push({
            step: 'git push',
            command: pushLogCommand,
            success: pushResult.exitCode === 0,
            stdout: pushResult.stdout,
            stderr: githubToken ? pushResult.stderr.split(githubToken).join('***') : pushResult.stderr,
            exitCode: pushResult.exitCode,
        });

        log.detail('exitCode', String(pushResult.exitCode));
        const maskedStderr = githubToken ? pushResult.stderr.split(githubToken).join('***') : pushResult.stderr;
        if (maskedStderr) { log.detail('stderr', maskedStderr.trim()); }
        if (pushResult.exitCode !== 0) {
            // push 失败记录警告但继续生成 patch
            vscode.window.showWarningMessage(
                `⚠️ git push 失败 (code=${pushResult.exitCode}): ${pushResult.stderr.split(githubToken || 'never_match').join('***')}`
            );
        }
    }

    // ---- Step 6: 生成 diff patch ----
    const diffResult = await execCommand('git diff main...HEAD', execOpts);
    logs.push({
        step: '生成 diff patch',
        command: 'git diff main...HEAD',
        success: diffResult.exitCode === 0,
        stdout: `(${diffResult.stdout.length} bytes)`,
        stderr: diffResult.stderr,
        exitCode: diffResult.exitCode,
    });

    // ---- Step 7: 写入 patch 文件 ----
    await ensureDir(outputDir);
    const patchFileName = `${currentBranch}.patch`;
    const patchFilePath = path.join(outputDir, patchFileName);

    let patchContent: string;
    if (diffResult.exitCode !== 0) {
        // diff 命令失败时写入说明
        patchContent = [
            `# Trae Harvester - Git Patch Export`,
            `# 分支: ${currentBranch}`,
            `# 时间: ${new Date().toISOString()}`,
            `# 状态: git diff 命令执行失败`,
            `# 错误: ${diffResult.stderr}`,
            `# 退出码: ${diffResult.exitCode}`,
            '',
        ].join('\n');
    } else if (diffResult.stdout.trim() === '') {
        // diff 为空时写入说明
        patchContent = [
            `# Trae Harvester - Git Patch Export`,
            `# 分支: ${currentBranch}`,
            `# 时间: ${new Date().toISOString()}`,
            `# 状态: 无差异 (当前分支与 main 相同)`,
            '',
        ].join('\n');
    } else {
        patchContent = diffResult.stdout;
    }

    currentGitPatchContent = patchContent;
    await atomicWrite(patchFilePath, patchContent);

    vscode.window.showInformationMessage(
        `✅ Patch 已导出: ${patchFilePath}`
    );

    // 输出操作日志到 Output Channel 方便调试
    const channel = vscode.window.createOutputChannel('Trae Harvester');
    channel.appendLine('=== Git Patch Export Log ===');
    channel.appendLine(`分支: ${currentBranch}`);
    channel.appendLine(`输出: ${patchFilePath}`);
    channel.appendLine(`Patch 大小: ${patchContent.length} bytes`);
    channel.appendLine('--- 步骤明细 ---');
    for (const log of logs) {
        const status = log.skipped ? '⏭ SKIP' : log.success ? '✅ OK' : '❌ FAIL';
        channel.appendLine(`  ${status} ${log.step}: ${log.command}`);
        if (log.skipReason) {
            channel.appendLine(`      原因: ${log.skipReason}`);
        }
        if (log.stderr && !log.skipped) {
            channel.appendLine(`      stderr: ${log.stderr.trim()}`);
        }
    }
    channel.show(true);

    log.timerEnd('exportPatch');
    log.setSuccess('Patch 导出完成');

    return patchFilePath;
}

/**
 * 注册 exportPatch 命令。
 */
export function registerExportPatchCommand(context: vscode.ExtensionContext): vscode.Disposable {
    return vscode.commands.registerCommand('trae-harvester.exportPatch', async () => {
        try {
            const outputPath = resolveOutputPath('patch');

            await exportGitPatch(outputPath);
        } catch (err: any) {
            const log = getLogger();
            log.error('GitPatch', 'Patch 导出失败', err);
            log.setError('Patch 导出失败');
            vscode.window.showErrorMessage(`❌ Patch 导出失败: ${err.message}`);
        }
    });
}
