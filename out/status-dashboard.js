#!/usr/bin/env node

// ============================================================
// Trae Harvester — 全局多窗口状态大屏 (Global Status Dashboard)
// ============================================================
// 扫描 ~/.trae-harvester-registry/ 目录，每 2 秒刷新一次。

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_DIR = path.join(os.homedir(), '.trae-harvester-registry');

// Helper to pad strings for tabular display
function padRight(str, len) {
    if (!str) str = '';
    str = String(str);
    const w = getStringWidth(str);
    return str + ' '.repeat(Math.max(0, len - w));
}

// Simple approximation of string visual width (for CJK support)
function getStringWidth(str) {
    let width = 0;
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        width += (code > 0x4e00 && code < 0x9fff) ? 2 : 1;
    }
    return width;
}

function getRegistry() {
    const result = {};
    try {
        if (!fs.existsSync(REGISTRY_DIR)) {
            return result;
        }
        const files = fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'));
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(REGISTRY_DIR, file);
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                const entry = JSON.parse(data);

                // 心跳超过 120 秒认为已死
                if (now - entry.last_heartbeat > 120000) {
                    continue;
                }

                const port = path.basename(file, '.json');
                result[port] = entry;
            } catch (e) {
                // ignore
            }
        }
    } catch (e) {
        // ignore
    }
    return result;
}

function printDashboard() {
    const registry = getRegistry();
    const now = Date.now();
    const activeSessions = [];

    for (const port in registry) {
        const entry = registry[port];
        activeSessions.push({
            port: port,
            pid: entry.pid,
            status: entry.status || 'IDLE',
            model: entry.model_id || '-',
            prompt: entry.prompt_id || '-',
            workspace: entry.workspace,
            auth: entry.auth_token ? '🔒' : '⚠️'
        });
    }

    // Clear console (ANSI escape codes)
    process.stdout.write('\x1Bc');

    console.log("====================================================================================================");
    console.log("                           🚜 Trae Harvester Global Dashboard v2.0                                 ");
    console.log("====================================================================================================");
    console.log(`Current Time: ${new Date().toLocaleTimeString()} | Active Windows: ${activeSessions.length} | Registry: Directory Mode\n`);

    if (activeSessions.length === 0) {
        console.log("  No active Trae Harvester windows found.");
        console.log("  Please open a VS Code window and ensure the extension is activated.\n");
    } else {
        const headers = [
            padRight("PORT", 6),
            padRight("PID", 8),
            padRight("STATUS", 12),
            padRight("AUTH", 5),
            padRight("MODEL", 18),
            padRight("PROMPT", 18),
            padRight("WORKSPACE", 30)
        ].join(' | ');

        console.log(headers);
        console.log("-".repeat(headers.length + 10));

        activeSessions.forEach(s => {
            const statusColor = s.status === 'COMPLETED' ? '\x1b[32m' : (s.status === 'RUNNING' ? '\x1b[33m' : '\x1b[90m');
            const resetColor = '\x1b[0m';
            
            const workspaceBase = path.basename(s.workspace) || s.workspace;

            const row = [
                padRight(s.port, 6),
                padRight(s.pid, 8),
                `${statusColor}${padRight(s.status, 12)}${resetColor}`,
                padRight(s.auth, 5),
                padRight(s.model, 18),
                padRight(s.prompt, 18),
                workspaceBase.length > 30 ? workspaceBase.substring(0, 27) + "..." : padRight(workspaceBase, 30)
            ].join(' | ');
            
            console.log(row);
        });
    }
    
    console.log("\n====================================================================================================");
    console.log("  Press Ctrl+C to exit. Refreshing every 2 seconds...");
}

// Initial print
printDashboard();

// Refresh loop
setInterval(printDashboard, 2000);
