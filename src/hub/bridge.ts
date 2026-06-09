#!/usr/bin/env node
// ============================================================
// Trae Harvester — Stdio ↔ HTTP MCP 桥接器 (Bridge)
// ============================================================
// 作为大模型的 stdio MCP 入口，把 JSON-RPC 请求转发到 Hub 的 HTTP /mcp 端点。
// 替代旧的 mcp-router.js，保留"复制一条 node 命令"的使用习惯。
//
// 用法（大模型 MCP 配置）：
//   command: node /path/to/out/hub/bridge.js
//
// ⚠️ 独立运行，不能 import 'vscode'。

import * as fs from 'fs';
import * as http from 'http';
import * as readline from 'readline';
import { HUB_INFO_FILE, HubInfo, MCP_PATH } from './protocol';

function log(msg: string): void {
    // Bridge 的日志输出到 stderr（stdin/stdout 用于协议）
    console.error(`[Bridge] ${msg}`);
}

function loadHubInfo(): HubInfo | null {
    if (!fs.existsSync(HUB_INFO_FILE)) {
        log(`Hub info file not found: ${HUB_INFO_FILE}`);
        return null;
    }
    try {
        const data = fs.readFileSync(HUB_INFO_FILE, 'utf-8');
        return JSON.parse(data);
    } catch (e: any) {
        log(`Failed to parse hub info: ${e?.message}`);
        return null;
    }
}

function forwardToHub(hubInfo: HubInfo, message: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: '127.0.0.1',
            port: hubInfo.port,
            path: MCP_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(message),
                'Authorization': `Bearer ${hubInfo.token}`,
            },
            timeout: 120000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 401) {
                    reject(new Error('Hub auth failed (401). The Hub may have restarted. Try restarting this bridge.'));
                    return;
                }
                resolve(data);
            });
        });
        req.on('error', (e) => reject(e));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Hub request timed out'));
        });
        req.write(message);
        req.end();
    });
}

async function main() {
    const hubInfo = loadHubInfo();
    if (!hubInfo) {
        log('Hub is not running. Start a VS Code window with Trae Harvester extension first.');
        process.exit(1);
    }
    log(`Connected to Hub at port ${hubInfo.port}`);

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
    });

    for await (const line of rl) {
        if (!line.trim()) continue;
        try {
            const response = await forwardToHub(hubInfo, line);
            process.stdout.write(response + '\n');
        } catch (err: any) {
            log(`Forward error: ${err?.message}`);
            const errorResponse = {
                jsonrpc: '2.0',
                id: null,
                error: { code: -32000, message: `Bridge error: ${err?.message}` },
            };
            process.stdout.write(JSON.stringify(errorResponse) + '\n');
        }
    }
}

main().catch(e => {
    log(`Bridge fatal error: ${e?.message}`);
    process.exit(1);
});
