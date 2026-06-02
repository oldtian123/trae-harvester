import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getLogger } from './logger';

const REPO_RAW_BASE = 'https://raw.githubusercontent.com/oldtian123/trae-harvester/main';
const PACKAGE_JSON_URL = `${REPO_RAW_BASE}/package.json`;
const VSIX_URL = `${REPO_RAW_BASE}/trae-harvester.vsix`;

/**
 * 检查并执行自动更新
 */
export async function checkForUpdates(context: vscode.ExtensionContext) {
    const log = getLogger();
    try {
        const currentVersion = context.extension.packageJSON.version;
        log.info('AutoUpdater', `当前版本: ${currentVersion}`);

        // Fetch remote package.json
        const remotePackageJsonStr = await fetchUrl(PACKAGE_JSON_URL);
        const remotePackageJson = JSON.parse(remotePackageJsonStr);
        const remoteVersion = remotePackageJson.version;

        if (!remoteVersion) return;

        log.info('AutoUpdater', `线上版本: ${remoteVersion}`);

        // 对比版本号
        if (isNewerVersion(currentVersion, remoteVersion)) {
            const action = await vscode.window.showInformationMessage(
                `Trae Harvester 发现新版本 (v${remoteVersion})，当前版本 v${currentVersion}。是否立即静默更新？`,
                '立即更新',
                '稍后'
            );

            if (action === '立即更新') {
                await downloadAndInstallUpdate(remoteVersion);
            }
        } else {
            log.info('AutoUpdater', '当前已经是最新版本');
        }
    } catch (e: any) {
        log.error('AutoUpdater', '检查更新失败', e);
    }
}

function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            // 处理重定向 (GitHub Raw 可能会有 301/302)
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`Failed to fetch ${url}, status code: ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

/**
 * 判断 remote 是否比 local 更新
 */
function isNewerVersion(local: string, remote: string): boolean {
    // 简单处理带有 "-beta" 等后缀的情况，只对比前面的数字
    const getVersionDigits = (v: string) => v.split('-')[0].split('.').map(s => parseInt(s, 10) || 0);
    const lParts = getVersionDigits(local);
    const rParts = getVersionDigits(remote);
    
    for (let i = 0; i < Math.max(lParts.length, rParts.length); i++) {
        const l = lParts[i] || 0;
        const r = rParts[i] || 0;
        if (r > l) return true;
        if (l > r) return false;
    }
    return false;
}

/**
 * 下载并调用 VS Code API 安装
 */
async function downloadAndInstallUpdate(version: string) {
    const log = getLogger();
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在下载 Trae Harvester v${version}...`,
        cancellable: false
    }, async (progress) => {
        try {
            const tmpPath = path.join(os.tmpdir(), `trae-harvester-v${version}.vsix`);
            log.info('AutoUpdater', `下载地址: ${VSIX_URL}`);
            log.info('AutoUpdater', `保存到: ${tmpPath}`);

            await downloadFile(VSIX_URL, tmpPath, progress);
            
            progress.report({ message: '下载完成，正在安装扩展...' });
            
            // 使用 VS Code 原生 API 安装 VSIX
            await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tmpPath));
            
            log.setSuccess(`扩展更新到 v${version} 成功`);
            
            const action = await vscode.window.showInformationMessage(
                `🎉 Trae Harvester v${version} 更新成功！需要重载窗口以生效。`,
                '重载窗口'
            );
            if (action === '重载窗口') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (e: any) {
            log.error('AutoUpdater', '下载或安装更新失败', e);
            vscode.window.showErrorMessage(`❌ 更新失败: ${e.message}`);
        }
    });
}

function downloadFile(url: string, dest: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        
        const doDownload = (targetUrl: string) => {
            https.get(targetUrl, (res) => {
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doDownload(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    return reject(new Error(`Failed to download, status code: ${res.statusCode}`));
                }
                
                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let downloadedBytes = 0;
                let lastPercent = 0;
                
                res.on('data', (chunk) => {
                    downloadedBytes += chunk.length;
                    if (totalBytes > 0) {
                        const percent = Math.floor((downloadedBytes / totalBytes) * 100);
                        if (percent > lastPercent) {
                            progress.report({ increment: percent - lastPercent, message: `已下载 ${percent}%` });
                            lastPercent = percent;
                        }
                    }
                });

                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(dest, () => {});
                reject(err);
            });
        };

        doDownload(url);
    });
}
