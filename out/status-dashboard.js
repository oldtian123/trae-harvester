#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const REGISTRY_FILE = path.join(os.homedir(), '.trae-harvester-registry.json');

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

function printDashboard() {
    let registry = {};
    try {
        if (fs.existsSync(REGISTRY_FILE)) {
            const data = fs.readFileSync(REGISTRY_FILE, 'utf-8');
            registry = JSON.parse(data);
        }
    } catch (e) {
        // Ignore JSON parse errors while updating
    }

    const now = Date.now();
    const activeSessions = [];

    for (const port in registry) {
        const entry = registry[port];
        // Clean up dead entries (no heartbeat for 120s)
        if (now - entry.last_heartbeat < 120000) {
            activeSessions.push({
                port: port,
                pid: entry.pid,
                status: entry.status || 'IDLE',
                model: entry.model_id || '-',
                prompt: entry.prompt_id || '-',
                workspace: entry.workspace
            });
        }
    }

    // Clear console (ANSI escape codes)
    process.stdout.write('\x1Bc');

    console.log("==========================================================================================");
    console.log("                           🚜 Trae Harvester Global Dashboard                             ");
    console.log("==========================================================================================");
    console.log(`Current Time: ${new Date().toLocaleTimeString()} | Active Windows: ${activeSessions.length}\n`);

    if (activeSessions.length === 0) {
        console.log("  No active Trae Harvester windows found.");
        console.log("  Please open a VS Code window and ensure the extension is activated.\n");
    } else {
        const headers = [
            padRight("PORT", 6),
            padRight("PID", 8),
            padRight("STATUS", 12),
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
                padRight(s.model, 18),
                padRight(s.prompt, 18),
                workspaceBase.length > 30 ? workspaceBase.substring(0, 27) + "..." : padRight(workspaceBase, 30)
            ].join(' | ');
            
            console.log(row);
        });
    }
    
    console.log("\n==========================================================================================");
    console.log("  Press Ctrl+C to exit. Refreshing every 2 seconds...");
}

// Initial print
printDashboard();

// Refresh loop
setInterval(printDashboard, 2000);
