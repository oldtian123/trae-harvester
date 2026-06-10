"use strict";
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
exports.checkForUpdates = checkForUpdates;
const vscode = __importStar(require("vscode"));
const https = __importStar(require("https"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const logger_1 = require("./logger");
const GITHUB_REPO = 'oldtian123/trae-harvester';
const GITHUB_API_BASE = 'https://api.github.com';
const RELEASES_URL = `${GITHUB_API_BASE}/repos/${GITHUB_REPO}/releases`;
/**
 * 检查并执行自动更新
 * @param context 扩展上下文
 * @param isManual 是否手动触发（影响提示框）
 */
async function checkForUpdates(context, isManual = false) {
    const log = (0, logger_1.getLogger)();
    try {
        const currentVersion = context.extension.packageJSON.version;
        log.info('AutoUpdater', `当前版本: ${currentVersion} (手动检查: ${isManual})`);
        const configToken = vscode.workspace.getConfiguration('traeHarvester').get('githubToken');
        const githubToken = configToken || process.env.GITHUB_TOKEN;
        // Fetch releases from GitHub API
        log.info('AutoUpdater', `正在检查最新版本: ${RELEASES_URL}`);
        const releases = await fetchJson(RELEASES_URL, githubToken);
        if (!Array.isArray(releases) || releases.length === 0) {
            throw new Error('没有找到任何发布版本');
        }
        // 获取最新的非草稿发布版（支持预发布版 prerelease）
        const releaseData = releases.find(r => !r.draft);
        if (!releaseData) {
            throw new Error('没有找到任何可用的发布版本');
        }
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
            const action = await vscode.window.showInformationMessage(`🎉 Trae Harvester 发现新版本 v${remoteVersion}（当前 v${currentVersion}）\n` +
                `文件: ${vsixAsset.name} (${sizeInMB} MB)\n` +
                `是否立即更新？`, '立即更新', '查看更新说明', '稍后');
            if (action === '立即更新') {
                await downloadAndInstallUpdate(vsixAsset.browser_download_url, vsixAsset.name, githubToken);
            }
            else if (action === '查看更新说明') {
                vscode.env.openExternal(vscode.Uri.parse(releaseData.html_url));
            }
        }
        else {
            log.info('AutoUpdater', '当前已经是最新版本');
            if (isManual) {
                vscode.window.showInformationMessage(`✅ 当前已经是最新版本 (v${currentVersion})`);
            }
        }
    }
    catch (e) {
        log.error('AutoUpdater', '检查更新失败', e);
        if (isManual) {
            vscode.window.showErrorMessage(`❌ 检查更新失败: ${e.message}\n请检查网络连接或 GitHub Token 配置`);
        }
    }
}
function fetchJson(url, token) {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Trae-Harvester-Updater',
            }
        };
        if (token) {
            options.headers['Authorization'] = `Bearer ${token}`;
        }
        https.get(url, options, (res) => {
            // 处理重定向
            if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchJson(res.headers.location, token).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`GitHub API 返回 ${res.statusCode}: ${res.statusMessage}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                }
                catch (e) {
                    reject(new Error('解析 JSON 失败'));
                }
            });
        }).on('error', reject);
    });
}
/**
 * 判断 remote 是否比 local 更新
 */
function isNewerVersion(local, remote) {
    const getVersionDigits = (v) => v.split('-')[0].split('.').map(s => parseInt(s, 10) || 0);
    const lParts = getVersionDigits(local);
    const rParts = getVersionDigits(remote);
    for (let i = 0; i < Math.max(lParts.length, rParts.length); i++) {
        const l = lParts[i] || 0;
        const r = rParts[i] || 0;
        if (r > l)
            return true;
        if (l > r)
            return false;
    }
    return false;
}
/**
 * 下载并调用 VS Code API 安装
 */
async function downloadAndInstallUpdate(downloadUrl, filename, token) {
    const log = (0, logger_1.getLogger)();
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
            }
            catch (cleanupErr) {
                log.warn('AutoUpdater', `清理临时文件失败: ${cleanupErr.message}`);
            }
            const action = await vscode.window.showInformationMessage(`🎉 Trae Harvester 更新成功！需要重载窗口以生效。`, '重载窗口', '稍后');
            if (action === '重载窗口') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        }
        catch (e) {
            log.error('AutoUpdater', '下载或安装更新失败', e);
            vscode.window.showErrorMessage(`❌ 更新失败: ${e.message}`);
        }
    });
}
function downloadFile(url, dest, progress, token) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        const doDownload = (targetUrl) => {
            const options = {
                headers: {
                    'User-Agent': 'Trae-Harvester-Updater',
                }
            };
            if (token) {
                options.headers['Authorization'] = `Bearer ${token}`;
            }
            https.get(targetUrl, options, (res) => {
                // 处理重定向
                if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return doDownload(res.headers.location);
                }
                if (res.statusCode !== 200) {
                    file.close();
                    fs.unlink(dest, () => { });
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
                fs.unlink(dest, () => { });
                reject(err);
            });
        };
        doDownload(url);
    });
}
//# sourceMappingURL=autoUpdater.js.map