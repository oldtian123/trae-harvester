// ============================================================
// Trae Harvester — Hub 协议 (Shared Hub Protocol)
// ============================================================
// 统一后端 Hub 与各窗口之间的共享常量、Session 形状与 WebSocket 消息协议。
//
// ⚠️ 本文件被独立守护进程 (daemon.ts / bridge.ts / dashboard.ts) 复用，
//    这些进程运行在 VS Code 扩展宿主之外，因此本文件【绝对不能 import 'vscode'】。

import * as os from 'os';
import * as path from 'path';
import { SessionStatus } from '../types';

export type { SessionStatus };

/** Hub 守护进程默认监听的固定端口 */
export const DEFAULT_HUB_PORT = 37650;

/** Hub 启动信息文件：记录端口/鉴权令牌/PID，供窗口与 bridge 发现 Hub */
export const HUB_INFO_FILE = path.join(os.homedir(), '.trae-harvester-hub.json');

/** 大模型连接的 MCP 路径 */
export const MCP_PATH = '/mcp';
/** 窗口连接的 WebSocket 路径 */
export const WS_PATH = '/ws';

/** Hub 写入磁盘的启动信息 */
export interface HubInfo {
    port: number;
    /** 随机鉴权令牌，窗口 WS 握手 / 大模型 HTTP 调用都需携带 */
    token: string;
    pid: number;
    startedAt: number;
}

/**
 * 一个已注册到 Hub 的窗口会话。
 * sessionId 由 Hub 在注册时分配（窗口注册时不携带）。
 */
export interface WindowSession {
    /** Hub 分配的会话标识（大模型按此定位窗口） */
    sessionId: string;
    /** 工作区绝对路径 */
    workspace: string;
    /** 窗口扩展宿主进程 PID */
    pid: number;
    /** 当前评测的仓库标识（来自 repoOptions，形如 "1. repoName"） */
    repo_id?: string;
    /** 当前仓库对应的分支（自动检测，只读） */
    branch?: string;
    /** 当前评测的模型标识 */
    model_id?: string;
    /** 当前评测的 Prompt 标识 */
    prompt_id?: string;
    /** 测试会话状态 */
    status: SessionStatus;
    /** 是否允许通过 MCP 执行高危操作（traeHarvester.mcpAllowExecution） */
    allowExecution: boolean;
}

/** 窗口注册时上报的会话信息（不含 Hub 分配的 sessionId） */
export type WindowSessionInit = Omit<WindowSession, 'sessionId'>;

// ============================================================
// WebSocket 消息协议
// ============================================================

/** 窗口 → Hub */
export type WindowToHubMessage =
    | { type: 'register'; session: WindowSessionInit }
    | { type: 'update'; patch: Partial<WindowSessionInit> }
    | { type: 'tool_response'; requestId: string; result?: ToolResult; error?: string };

/** Hub → 窗口 */
export type HubToWindowMessage =
    | { type: 'registered'; sessionId: string }
    | { type: 'tool_request'; requestId: string; tool: string; args: Record<string, unknown> };

/**
 * 工具执行结果（窗口侧 toolHandlers 的返回值，MCP content 形状）。
 * 添加索引签名以兼容 MCP SDK 的 CallToolResult 类型。
 */
export interface ToolResult {
    [key: string]: unknown;
    content: Array<{ type: 'text'; text: string }>;
    isError?: boolean;
}

/** 窗口侧可被 Hub 反向调用的工具名（去掉 session_id 维度后的本地动作） */
export const WINDOW_TOOLS = {
    GET_EVIDENCE: 'get_evidence',
    COLLECT_ALL: 'collect_all',
    EXPORT_PATCH: 'export_patch',
    GET_GIT_PATCH: 'get_git_patch',
    RUN_ALL_TESTS: 'run_all_tests',
    IMPORT_TEST_PLAN: 'import_test_plan',
    GET_AI_CONTEXT: 'get_ai_context',
    GET_PLAN: 'get_plan',
    GET_TEST_RESULTS: 'get_test_results',
    GET_CHECK_ITEMS: 'get_check_items',
    GET_LOGS: 'get_logs',
} as const;

export type WindowToolName = typeof WINDOW_TOOLS[keyof typeof WINDOW_TOOLS];
