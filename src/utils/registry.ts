// ============================================================
// Trae Harvester — 目录式并发安全注册表 (Directory-based Registry)
// ============================================================
// 每个 VS Code 实例只管理自己的状态文件：~/.trae-harvester-registry/<port>.json
// 彻底消除多窗口并发写入同一个 JSON 文件导致的 Lost Update 问题。

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { RegistryEntry, SessionStatus } from '../types';
import { getLogger } from './logger';

/** 注册表目录路径 */
const REGISTRY_DIR = path.join(os.homedir(), '.trae-harvester-registry');

/** 旧版单文件路径（用于迁移清理） */
const LEGACY_REGISTRY_FILE = path.join(os.homedir(), '.trae-harvester-registry.json');

/** 当前实例的注册信息 */
let currentEntry: RegistryEntry | null = null;
/** 心跳定时器 */
let heartbeatInterval: NodeJS.Timeout | null = null;

/**
 * 确保注册表目录存在，并清理旧版单文件。
 */
function ensureRegistryDir(): void {
    try {
        if (!fs.existsSync(REGISTRY_DIR)) {
            fs.mkdirSync(REGISTRY_DIR, { recursive: true });
        }
        // 清理旧版单文件
        if (fs.existsSync(LEGACY_REGISTRY_FILE)) {
            try {
                fs.unlinkSync(LEGACY_REGISTRY_FILE);
                getLogger().info('Registry', '已清理旧版注册表文件 .trae-harvester-registry.json');
            } catch (e) {
                // 忽略清理失败
            }
        }
    } catch (e) {
        getLogger().error('Registry', 'Failed to create registry directory', e);
    }
}

/**
 * 获取当前实例的注册文件路径。
 */
function getEntryFilePath(port: number): string {
    return path.join(REGISTRY_DIR, `${port}.json`);
}

/**
 * 将当前实例的信息写入自己的独立文件。
 */
function writeOwnEntry(entry: RegistryEntry): void {
    try {
        ensureRegistryDir();
        const filePath = getEntryFilePath(entry.port);
        fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf-8');
    } catch (e) {
        getLogger().error('Registry', `Failed to write registry entry for port ${entry.port}`, e);
    }
}

/**
 * 删除当前实例的注册文件。
 */
function deleteOwnEntry(port: number): void {
    try {
        const filePath = getEntryFilePath(port);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        getLogger().error('Registry', `Failed to delete registry entry for port ${port}`, e);
    }
}

/**
 * 扫描注册表目录，返回所有存活的实例。
 * 自动清理过期条目（心跳超过 60 秒的文件）。
 */
export function readAllEntries(): Record<string, RegistryEntry> {
    const result: Record<string, RegistryEntry> = {};
    try {
        ensureRegistryDir();
        const files = fs.readdirSync(REGISTRY_DIR).filter(f => f.endsWith('.json'));
        const now = Date.now();

        for (const file of files) {
            const filePath = path.join(REGISTRY_DIR, file);
            try {
                const data = fs.readFileSync(filePath, 'utf-8');
                const entry: RegistryEntry = JSON.parse(data);
                
                // 检查心跳是否过期（超过 60 秒）
                if (now - entry.last_heartbeat > 60000) {
                    // 自动 GC：删除过期文件
                    try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
                    continue;
                }

                // 检查进程是否存活
                try {
                    process.kill(entry.pid, 0);
                } catch (err: any) {
                    if (err.code === 'ESRCH') {
                        // 进程确实不存在了，GC
                        try { fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
                        continue;
                    }
                    // EPERM 等其他错误：假设进程仍存活（Windows 跨进程权限问题）
                }

                const port = path.basename(file, '.json');
                result[port] = entry;
            } catch (e) {
                // 单个文件解析失败不影响其他文件
            }
        }
    } catch (e) {
        getLogger().error('Registry', 'Failed to read registry directory', e);
    }
    return result;
}

/**
 * 注册当前 VS Code 实例到全局注册表。
 * 生成唯一的 auth_token 用于鉴权。
 */
export function registerInstance(port: number, workspacePath: string): string {
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
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        if (currentEntry) {
            currentEntry.last_heartbeat = Date.now();
            writeOwnEntry(currentEntry);
        }
    }, 15000); // 15s heartbeat

    getLogger().info('Registry', `Instance registered: port=${port}, token=${authToken.substring(0, 8)}...`);
    return authToken;
}

/**
 * 注销当前实例。
 */
export function unregisterInstance(): void {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }
    if (currentEntry) {
        deleteOwnEntry(currentEntry.port);
        getLogger().info('Registry', `Instance unregistered: port=${currentEntry.port}`);
        currentEntry = null;
    }
}

/**
 * 更新当前实例的状态和标识。
 */
export function updateInstanceStatus(status: SessionStatus, modelId?: string, promptId?: string): void {
    if (currentEntry) {
        currentEntry.status = status;
        if (modelId !== undefined) currentEntry.model_id = modelId;
        if (promptId !== undefined) currentEntry.prompt_id = promptId;
        currentEntry.last_heartbeat = Date.now();
        writeOwnEntry(currentEntry);
    }
}

/**
 * 获取当前实例的 auth_token（供 MCP Server 鉴权中间件使用）。
 */
export function getCurrentAuthToken(): string | null {
    return currentEntry?.auth_token || null;
}
