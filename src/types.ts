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
    /** 评估相关的标识 */
    repo_id?: string;
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
    /** 评估相关的标识 */
    repo_id?: string;
    model_id?: string;
    prompt_id?: string;
}

// ---- 多窗口会话状态 ----
// 注：窗口注册表已由文件目录迁移到统一 Hub（见 src/hub/protocol.ts 的 WindowSession）。
// 这里仅保留被测试引擎复用的会话状态枚举。

export type SessionStatus = 'IDLE' | 'RUNNING' | 'COMPLETED';

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
