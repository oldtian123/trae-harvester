import * as vscode from 'vscode';
import * as https from 'https';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getLogger } from './logger';

const GITHUB_REPO = 'oldtian123/trae-harvester';
const GITHUB_API_BASE = 'https://api.github.com';
const LATEST_RELEASE_URL = `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/releases/latest`;

interface GitHubRelease {
    tag_name: string;
    name: string;
    html_url: string;
    assets: Array<{
        name: string;
        browser_download_url: string;
        size: number;
    }>;
}

/**
 * 检查并执行自动更新
 * @param context 扩展上下文
 * @param isManual 是否手动触发（影响提示框）
 */
export async function checkForUpdates(context: vscode.ExtensionContext, isManual: boolean = false) {
    const log = getLogger();
    try {
        const currentVersion = context.extension.packageJSON.version;
        log.info('AutoUpdater', `当前版本: ${currentVersion} (手动检查: ${isManual})`);

        const configToken = vscode.workspace.getConfiguration('traeHarvester').get<string>('githubToken');
        const githubToken = configToken || process.env.GITHUB_TOKEN;

        // Fetch latest release from GitHub API
        log.info('AutoUpdater', `正在检查最新版本: ${LATEST_RELEASE_URL}`);
        const releaseData = await fetchJson<GitHubRelease>(LATEST_RELEASE_URL, githubToken);

        const remoteVersion = releaseData.tag_name.replace(/^v/, ''); // 去掉 v 前缀
        log.info('AutoUpdater', `线上最新版本: ${remoteVersion}`);

        // 对比版本号
        if (isNewerVersion(currentVersion, remoteVersion)) {
            // 查找 .vsix 文件
            const vsixAsset = releaseData.assets.find(a => a.name.endsWith('.vsix'));
            if (!vsixAsset) {
                if (isManual) {
                    vscode.window.showErrorMessage('❌ 最新版本没有找到 VSIX 文件，请手动安装');
                }
                return;
            }

            const sizeInMB = (vsixAsset.size / 1024 / 1024).toFixed(2);
            const action = await vscode.window.showInformationMessage(
                `🎉 Trae Harvester 发现新版本 v${remoteVersion}（当前 v${currentVersion}）\n` +
                `文件: ${vsixAsset.name} (${sizeInMB} MB)\n` +
                `是否立即更新？`,
                '立即更新',
                '查看更新说明',
                '稍后'
            );

            if (action === '立即更新') {
                await downloadAndInstallUpdate(vsixAsset.browser_download_url, vsixAsset.name, githubToken);
            } else if (action === '查看更新说明') {
                vscode.env.openExternal(vscode.Uri.parse(releaseData.html_url));
            }
        } else {
            log.info('AutoUpdater', '当前已经是最新版本');
            if (isManual) {
                vscode.window.showInformationMessage(`✅ 当前已经是最新版本 (v${currentVersion})`);
            }
        }
    } catch (e: any) {
        log.error('AutoUpdater', '检查更新失败', e);
        if (isManual) {
            vscode.window.showErrorMessage(`❌ 检查更新失败: ${e.message}\n请检查网络连接或 GitHub Token 配置`);
        }
    }
}

function fetchJson<T>(url: string, token?: string): Promise<T> {
    return new Promise((resolve, reject) => {
        const options: https.RequestOptions = {
            headers: {
                'User-Agent': 'Trae-Harvester-Updater',
            } as Record<string, string>
        };
        if (token) {
            (options.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
        }

        https.get(url, options, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson<T>(res.headers.location, token).then(resolve).catch(reject);
            }

            if (res.statusCode !== 200) {
                return reject(new Error(`GitHub API 返回 ${res.statusCode}: ${res.statusMessage}`));
            }

            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('解析 JSON 失败'));
                }
            });
        }).on('error', reject);
    });
}

/**
 * 判断 remote 是否比 local 更新
 */
function isNewerVersion(local: string, remote: string): boolean {
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
async function downloadAndInstallUpdate(downloadUrl: string, filename: string, token?: string) {
    const log = getLogger();
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: `正在下载 ${filename}...`,
        cancellable: false
    }, async (progress) => {
        try {
            const tmpPath = path.join(os.tmpdir(), `trae-harvester-update-${Date.now()}.vsix`);
            log.info('AutoUpdater', `下载地址: ${downloadUrl}`);
            log.info('AutoUpdater', `保存到: ${tmpPath}`);

            await downloadFile(downloadUrl, tmpPath, progress, token);

            progress.report({ message: '下载完成，正在安装扩展...' });

            // 使用 VS Code 原生 API 安装 VSIX
            await vscode.commands.executeCommand('workbench.extensions.installExtension', vscode.Uri.file(tmpPath));

            log.setSuccess(`扩展更新成功: ${filename}`);

            // 清理临时文件
            try {
                if (fs.existsSync(tmpPath)) {
                    fs.unlinkSync(tmpPath);
                    log.info('AutoUpdater', `已清理临时文件: ${tmpPath}`);
                }
            } catch (cleanupErr: any) {
                log.warn('AutoUpdater', `清理临时文件失败: ${cleanupErr.message}`);
            }

            const action = await vscode.window.showInformationMessage(
                `🎉 Trae Harvester 更新成功！需要重载窗口以生效。`,
                '重载窗口',
                '稍后'
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

function downloadFile(url: string, dest: string, progress: vscode.Progress<{ message?: string; increment?: number }>, token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);

        const doDownload = (targetUrl: string) => {
            const options: https.RequestOptions = {
                headers: {
                    'User-Agent': 'Trae-Harvester-Updater',
                } as Record<string, string>
            };
            if (token) {
                (options.headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
            }

            https.get(targetUrl, options, (res) => {
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doDownload(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlink(dest, () => {});
                    return reject(new Error(`下载失败，HTTP ${res.statusCode}`));
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
                file.close();
                fs.unlink(dest, () => {});
                reject(err);
            });
        };

        doDownload(url);
    });
}
