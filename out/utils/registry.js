"use strict";
// ============================================================
// Trae Harvester — 目录式并发安全注册表 (Directory-based Registry)
// ============================================================
// 每个 VS Code 实例只管理自己的状态文件：~/.trae-harvester-registry/<port>.json
// 彻底消除多窗口并发写入同一个 JSON 文件导致的 Lost Update 问题。
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
exports.readAllEntries = readAllEntries;
exports.registerInstance = registerInstance;
exports.unregisterInstance = unregisterInstance;
exports.updateInstanceStatus = updateInstanceStatus;
exports.getCurrentAuthToken = getCurrentAuthToken;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const crypto = __importStar(require("crypto"));
const logger_1 = require("./logger");
/** 注册表目录路径 */
const REGISTRY_DIR = path.join(os.homedir(), '.trae-harvester-registry');
/** 旧版单文件路径（用于迁移清理） */
const LEGACY_REGISTRY_FILE = path.join(os.homedir(), '.trae-harvester-registry.json');
/** 当前实例的注册信息 */
let currentEntry = null;
/** 心跳定时器 */
let heartbeatInterval = null;
/**
 * 确保注册表目录存在，并清理旧版单文件。
 */
function ensureRegistryDir() {
    try {
        if (!fs.existsSync(REGISTRY_DIR)) {
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
        }
        // 清理旧版单文件
        if (fs.existsSync(LEGACY_REGISTRY_FILE)) {
            try {
                fs.unlinkSync(LEGACY_REGISTRY_FILE);
                (0, logger_1.getLogger)().info('Registry', '已清理旧版注册表文件 .trae-harvester-registry.json');
            }
            catch (e) {
                // 忽略清理失败
            }
        }
    }
    catch (e) {
        (0, logger_1.getLogger)().error('Registry', 'Failed to create registry directory', e);
    }
}
/**
 * 获取当前实例的注册文件路径。
 */
function getEntryFilePath(port) {
    return path.join(REGISTRY_DIR, `${port}.json`);
}
/**
 * 将当前实例的信息写入自己的独立文件。
 */
function writeOwnEntry(entry) {
    try {
        ensureRegistryDir();
        const filePath = getEntryFilePath(entry.port);
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    }
    catch (e) {
        (0, logger_1.getLogger)().error('Registry', `Failed to write registry entry for port ${entry.port}`, e);
    }
}
/**
 * 删除当前实例的注册文件。
 */
function deleteOwnEntry(port) {
    try {
        const filePath = getEntryFilePath(port);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
    catch (e) {
        (0, logger_1.getLogger)().error('Registry', `Failed to delete registry entry for port ${port}`, e);
    }
}
/**
 * 扫描注册表目录，返回所有存活的实例。
 * 自动清理过期条目（心跳超过 60 秒的文件）。
 */
function readAllEntries() {
    const result = {};
    try {
        ensureRegistryDir();
        const files = fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'));
        const now = Date.now();
        for (const file of files) {
            const filePath = path.join(REGISTRY_DIR, file);
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                const entry = JSON.parse(data);
                // 检查心跳是否过期（超过 60 秒）
                if (now - entry.last_heartbeat > 60000) {
                    // 自动 GC：删除过期文件
                    try {
                        fs.unlinkSync(filePath);
                    }
                    catch (e) { /* ignore */ }
                    continue;
                }
                // 检查进程是否存活
                try {
                    process.kill(entry.pid, 0);
                }
                catch (err) {
                    if (err.code === 'ESRCH') {
                        // 进程确实不存在了，GC
                        try {
                            fs.unlinkSync(filePath);
                        }
                        catch (e) { /* ignore */ }
                        continue;
                    }
                    // EPERM 等其他错误：假设进程仍存活（Windows 跨进程权限问题）
                }
                const port = path.basename(file, '.json');
                result[port] = entry;
            }
            catch (e) {
                // 单个文件解析失败不影响其他文件
            }
        }
    }
    catch (e) {
        (0, logger_1.getLogger)().error('Registry', 'Failed to read registry directory', e);
    }
    return result;
}
/**
 * 注册当前 VS Code 实例到全局注册表。
 * 生成唯一的 auth_token 用于鉴权。
 */
function registerInstance(port, workspacePath) {
    const authToken = crypto.randomBytes(32).toString('hex');
    currentEntry = {
        port,
        pid: process.pid,
        workspace: workspacePath,
        status: 'IDLE',
        last_heartbeat: Date.now(),
        auth_token: authToken
    };
    writeOwnEntry(currentEntry);
    // 启动心跳
    if (heartbeatInterval)
        clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (currentEntry) {
            currentEntry.last_heartbeat = Date.now();
            writeOwnEntry(currentEntry);
        }
    }, 15000); // 15s heartbeat
    (0, logger_1.getLogger)().info('Registry', `Instance registered: port=${port}, token=${authToken.substring(0, 8)}...`);
    return authToken;
}
/**
 * 注销当前实例。
 */
function unregisterInstance() {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (currentEntry) {
        deleteOwnEntry(currentEntry.port);
        (0, logger_1.getLogger)().info('Registry', `Instance unregistered: port=${currentEntry.port}`);
        currentEntry = null;
    }
}
/**
 * 更新当前实例的状态和标识。
 */
function updateInstanceStatus(status, modelId, promptId) {
    if (currentEntry) {
        currentEntry.status = status;
        if (modelId !== undefined)
            currentEntry.model_id = modelId;
        if (promptId !== undefined)
            currentEntry.prompt_id = promptId;
        currentEntry.last_heartbeat = Date.now();
        writeOwnEntry(currentEntry);
    }
}
/**
 * 获取当前实例的 auth_token（供 MCP Server 鉴权中间件使用）。
 */
function getCurrentAuthToken() {
    return currentEntry?.auth_token || null;
}
//# sourceMappingURL=registry.js.map