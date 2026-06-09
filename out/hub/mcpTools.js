"use strict";
// ============================================================
// Trae Harvester — Hub 侧 MCP 工具定义 (Aggregator Tools)
// ============================================================
// 定义大模型可见的聚合工具：列出所有窗口、按 session_id 拉取证据/导出 Patch/执行测试等。
// 工具本身只负责把调用按 session_id 路由到对应窗口（通过 deps.callWindow 经 WS 转发），
// 真正的业务执行发生在窗口侧的 toolHandlers。
//
// ⚠️ 运行在独立守护进程中，【不能 import 'vscode'】。
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHubMcpServer = createHubMcpServer;
const mcp_js_1 = require("@modelcontextprotocol/sdk/server/mcp.js");
const zod_1 = require("zod");
const protocol_1 = require("./protocol");
const HUB_VERSION = '1.0.0';
function textResult(text, isError = false) {
    return { content: [{ type: 'text', text }], isError };
}
/**
 * 解析目标窗口：
 * - 显式传 session_id 且存在 → 用它
 * - 未传 session_id 且恰好只有 1 个窗口 → 自动选中
 * - 0 个 / 多个且未指定 → 返回提示让大模型先 list_windows
 */
function resolveSession(deps, sessionId) {
    const windows = deps.listWindows();
    if (sessionId) {
        const found = windows.find(w => w.sessionId === sessionId);
        if (!found) {
            return { ok: false, message: `Session "${sessionId}" not found or inactive. Call trea_harvester_list_windows to see active windows.` };
        }
        return { ok: true, sessionId };
    }
    if (windows.length === 1) {
        return { ok: true, sessionId: windows[0].sessionId };
    }
    if (windows.length === 0) {
        return { ok: false, message: 'No active Trae Harvester windows are registered. Open a VS Code window with the extension first.' };
    }
    return { ok: false, message: `Multiple windows are active (${windows.length}). Specify session_id. Call trea_harvester_list_windows to choose one.` };
}
/**
 * 构造一个配置好聚合工具的 MCP Server 实例。
 * 每个传入连接（SSE / stateless）各创建一个，但共享同一份 deps（Hub 注册表）。
 */
function createHubMcpServer(deps) {
    const server = new mcp_js_1.McpServer({ name: 'trae-harvester-hub', version: HUB_VERSION });
    // ---- 1. 列出所有窗口（Hub 本地，不转发） ----
    server.tool('trea_harvester_list_windows', 'List all active VS Code windows running Trae Harvester. Returns each window\'s session_id, repo, branch, model, prompt and test status — use this to know which window scores which Prompt before fetching evidence.', {}, async () => {
        const windows = deps.listWindows().map(w => ({
            session_id: w.sessionId,
            repo: w.repo_id || 'None',
            branch: w.branch || 'None',
            model: w.model_id || 'None',
            prompt: w.prompt_id || 'None',
            status: w.status,
            workspace: w.workspace,
            read_only: !w.allowExecution,
        }));
        return textResult(JSON.stringify(windows, null, 2));
    });
    // ---- 2. 连接测试（Hub 本地） ----
    server.tool('trea_harvester_test_connection', 'Test the connection to the Trae Harvester Hub. Returns the number of active windows.', {}, async () => {
        const n = deps.listWindows().length;
        return textResult(`✅ Connected to Trae Harvester Hub. ${n} active window(s) registered.`);
    });
    // ---- 3. 转发型工具：按 session_id 路由到窗口执行 ----
    const sessionArg = { session_id: zod_1.z.string().optional().describe('Target window session_id (from trea_harvester_list_windows). Optional when exactly one window is active.') };
    const forward = (sessionId, tool, args = {}) => {
        const r = resolveSession(deps, sessionId);
        if (!r.ok)
            return Promise.resolve(textResult(r.message, true));
        return deps.callWindow(r.sessionId, tool, args).catch((e) => textResult(`Failed to reach window: ${e?.message || e}`, true));
    };
    server.tool('trea_harvester_get_evidence', 'Gather the complete evaluation evidence (git patch + test results + manual check items + AI context) from a target window, returning one JSON object for scoring.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_EVIDENCE));
    server.tool('trea_harvester_export_patch', 'Export a fresh git patch (current branch vs main) in the target window and return the patch file path.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.EXPORT_PATCH));
    server.tool('trea_harvester_get_git_patch', 'Return the git patch content stored in the target window from its last export.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_GIT_PATCH));
    server.tool('trea_harvester_run_all_tests', 'Execute all test steps in the target window (subject to that window\'s read-only mode).', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.RUN_ALL_TESTS));
    server.tool('trea_harvester_import_test_plan', 'Import a test plan JSON into the target window (subject to that window\'s read-only mode).', { ...sessionArg, jsonText: zod_1.z.string().describe('JSON string matching the TestPlan format, e.g. {"steps":[...],"check_items":[...]}') }, async ({ session_id, jsonText }) => forward(session_id, protocol_1.WINDOW_TOOLS.IMPORT_TEST_PLAN, { jsonText }));
    server.tool('trea_harvester_get_ai_context', 'Get the AI-generated context (agent thinking process) from the target window for evaluation scoring.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_AI_CONTEXT));
    server.tool('trea_harvester_get_plan', 'Return the current test plan loaded in the target window.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_PLAN));
    server.tool('trea_harvester_get_test_results', 'Return the per-step test execution results from the target window.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_TEST_RESULTS));
    server.tool('trea_harvester_get_check_items', 'Return the manual check items and their pass/fail state from the target window.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_CHECK_ITEMS));
    server.tool('trea_harvester_get_logs', 'Return the plugin runtime logs from the target window.', sessionArg, async ({ session_id }) => forward(session_id, protocol_1.WINDOW_TOOLS.GET_LOGS));
    return server;
}
//# sourceMappingURL=mcpTools.js.map