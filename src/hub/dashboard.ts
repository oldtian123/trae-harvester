#!/usr/bin/env node
// ============================================================
// Trae Harvester — 全局多窗口状态大屏 (Status Dashboard)
// ============================================================
// 每 2s 调 Hub GET /windows 渲染表格，替代旧 status-dashboard.js。
// 列：PORT / PID / REPO / BRANCH / MODEL / PROMPT / STATUS / WORKSPACE
//
// ⚠️ 独立运行，不能 import 'vscode'。

import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { HUB_INFO_FILE, HubInfo, WindowSession } from './protocol';

function log(msg: string): void {
    console.error(`[Dashboard] ${msg}`);
}

function loadHubInfo(): HubInfo | null {
    if (!fs.existsSync(HUB_INFO_FILE)) {
        return null;
    }
    try {
        const data = fs.readFileSync(HUB_INFO_FILE, 'utf-8');
        return JSON.parse(data);
    } catch {
        return null;
    }
}

function fetchWindows(hubInfo: HubInfo): Promise<WindowSession[]> {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${hubInfo.port}/windows`, { timeout: 3000 }, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Hub returned ${res.statusCode}`));
                return;
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e: any) {
                    reject(new Error('Invalid JSON from Hub'));
                }
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Hub timeout'));
        });
    });
}

/** 计算字符串显示宽度（中日韩字符算2宽） */
function getStringWidth(str: string): number {
    let width = 0;
    for (const char of str) {
        const code = char.charCodeAt(0);
        // 简化的 CJK 范围判断
        if ((code >= 0x4E00 && code <= 0x9FFF) || (code >= 0x3400 && code <= 0x4DBF) ||
            (code >= 0xAC00 && code <= 0xD7AF) || (code >= 0x3040 && code <= 0x30FF)) {
            width += 2;
        } else {
            width += 1;
        }
    }
    return width;
}

/** 右填充到指定显示宽度 */
function padRight(str: string, targetWidth: number): string {
    const currentWidth = getStringWidth(str);
    if (currentWidth >= targetWidth) {
        return str;
    }
    return str + ' '.repeat(targetWidth - currentWidth);
}

function truncate(str: string, maxWidth: number): string {
    if (getStringWidth(str) <= maxWidth) return str;
    let result = '';
    let w = 0;
    for (const char of str) {
        const cw = (char.charCodeAt(0) >= 0x4E00 && char.charCodeAt(0) <= 0x9FFF) ? 2 : 1;
        if (w + cw > maxWidth - 3) break;
        result += char;
        w += cw;
    }
    return result + '...';
}

function colorize(text: string, color: string): string {
    const colors: Record<string, string> = {
        green: '\x1b[32m',
        yellow: '\x1b[33m',
        gray: '\x1b[90m',
        reset: '\x1b[0m',
    };
    return `${colors[color] || ''}${text}${colors.reset}`;
}

function printDashboard(windows: WindowSession[], hubInfo: HubInfo): void {
    console.clear();
    const now = new Date().toLocaleString('zh-CN', { hour12: false });
    console.log('\n='.repeat(60));
    console.log(colorize('  Trae Harvester — 全局多窗口状态大屏', 'green'));
    console.log(`  时间: ${now}  |  活跃窗口: ${windows.length}  |  Hub 端口: ${hubInfo.port}`);
    console.log('='.repeat(60) + '\n');

    if (windows.length === 0) {
        console.log(colorize('  暂无活跃窗口。请打开 VS Code 并激活扩展。', 'gray'));
        console.log();
        return;
    }

    const colW = { sid: 10, pid: 8, repo: 12, branch: 15, model: 18, prompt: 18, status: 12, workspace: 30 };
    const header = [
        padRight('SESSION_ID', colW.sid),
        padRight('PID', colW.pid),
        padRight('REPO', colW.repo),
        padRight('BRANCH', colW.branch),
        padRight('MODEL', colW.model),
        padRight('PROMPT', colW.prompt),
        padRight('STATUS', colW.status),
        padRight('WORKSPACE', colW.workspace),
    ].join('  ');
    console.log(colorize(header, 'green'));
    console.log('-'.repeat(140));

    for (const w of windows) {
        const statusColor = w.status === 'COMPLETED' ? 'green' : w.status === 'RUNNING' ? 'yellow' : 'gray';
        const row = [
            padRight(w.sessionId.substring(0, 10), colW.sid),
            padRight(String(w.pid), colW.pid),
            padRight(truncate(w.repo_id || '-', colW.repo), colW.repo),
            padRight(truncate(w.branch || '-', colW.branch), colW.branch),
            padRight(truncate(w.model_id || '-', colW.model), colW.model),
            padRight(truncate(w.prompt_id || '-', colW.prompt), colW.prompt),
            padRight(colorize(w.status, statusColor), colW.status + 9), // 9 = ANSI 转义序列长度补偿
            padRight(truncate(path.basename(w.workspace), colW.workspace), colW.workspace),
        ].join('  ');
        console.log(row);
    }
    console.log();
}

async function main() {
    console.log(colorize('\n⏳ 正在连接 Hub...\n', 'yellow'));

    setInterval(async () => {
        const hubInfo = loadHubInfo();
        if (!hubInfo) {
            console.clear();
            console.log('\n='.repeat(60));
            console.log(colorize('  Trae Harvester — Hub 未运行', 'gray'));
            console.log('='.repeat(60));
            console.log(colorize('\n  请打开 VS Code 窗口并激活 Trae Harvester 扩展。\n', 'gray'));
            return;
        }
        try {
            const windows = await fetchWindows(hubInfo);
            printDashboard(windows, hubInfo);
        } catch (err: any) {
            console.clear();
            console.log('\n='.repeat(60));
            console.log(colorize('  Hub 连接失败', 'gray'));
            console.log('='.repeat(60));
            console.log(colorize(`\n  ${err?.message}\n`, 'gray'));
        }
    }, 2000);
}

main().catch(e => {
    log(`Dashboard fatal error: ${e?.message}`);
    process.exit(1);
});
