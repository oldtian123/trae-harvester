// ============================================================
// Trae Harvester — 共享类型定义
// ============================================================

// ---- 功能二：测试命令编排 ----

export interface CheckItem {
    text: string;
    passed: boolean;
}

/** 用户输入的测试计划 JSON 结构 */
export interface TestPlan {
    steps: TestStep[];
    check_items?: CheckItem[];
    /** 评估相关的模型和Prompt标识 */
    model_id?: string;
    prompt_id?: string;
}

/** 单个测试步骤 */
export interface TestStep {
    step_number: number;
    title: string;
    command: string;
    /** 可选：命令执行的工作目录 */
    cwd?: string;
    /** 可选：超时时间(ms) */
    timeout?: number;
}

/** 单步执行结果 */
export interface StepResult {
    step_number: number;
    title: string;
    command: string;
    status: 'PASS' | 'FAIL' | 'SKIP' | 'ERROR' | 'TIMEOUT' | 'PENDING';
    exit_code: number | null;
    duration_ms: number;
    console_output: string;
    error_message?: string;
}

/** 最终测试结果 JSON */
export interface TestResult {
    timestamp: string;
    final_status: 'PASS' | 'FAIL' | 'PARTIAL';
    total_steps: number;
    passed_steps: number;
    failed_steps: number;
    skipped_steps: number;
    steps: StepResult[];
    check_items?: CheckItem[];
    ai_context?: string;
    /** 评估相关的模型和Prompt标识 */
    model_id?: string;
    prompt_id?: string;
}

// ---- 功能四：多窗口聚合路由与注册表 ----

export type SessionStatus = 'IDLE' | 'RUNNING' | 'COMPLETED';

export interface RegistryEntry {
    port: number;
    pid: number;
    workspace: string;
    status: SessionStatus;
    model_id?: string;
    prompt_id?: string;
    last_heartbeat: number;
    /** 随机生成的鉴权令牌，每个实例唯一 */
    auth_token?: string;
}

// ---- 功能三：AI 上下文 ----

/** AI 对话消息 */
export interface AgentMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    thought_chain?: string;
}

/** AI 对话 Session */
export interface AgentSession {
    session_id: string;
    timestamp?: string;
    messages: AgentMessage[];
}

/** AI 上下文导出 JSON */
export interface AgentContextExport {
    timestamp: string;
    source_db: string;
    extraction_note: string;
    sessions: AgentSession[];
}

// ---- 子进程执行结果 ----

/** 命令执行结果 */
export interface CommandResult {
    stdout: string;
    stderr: string;
    exitCode: number | null;
    timedOut?: boolean;
}

// ---- Webview 消息协议 ----

/** Extension → Webview 消息 */
export type ExtToWebviewMessage =
    | { command: 'loadSteps'; steps: TestStep[]; checkItems?: CheckItem[] }
    | { command: 'stepStarted'; stepNumber: number }
    | { command: 'stepCompleted'; stepNumber: number; result: StepResult }
    | { command: 'allCompleted'; result: TestResult }
    | { command: 'error'; message: string };

/** Webview → Extension 消息 */
export type WebviewToExtMessage =
    | { command: 'runAll' }
    | { command: 'runStep'; stepNumber: number }
    | { command: 'deleteStep'; stepNumber: number }
    | { command: 'addStep'; title: string; commandToRun: string }
    | { command: 'addCheckItem'; item: string }
    | { command: 'removeCheckItem'; index: number }
    | { command: 'toggleCheckItem'; index: number; passed: boolean }
    | { command: 'copyJson' }
    | { command: 'ready' };
