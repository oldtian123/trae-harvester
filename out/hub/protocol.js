"use strict";
// ============================================================
// Trae Harvester — Hub 协议 (Shared Hub Protocol)
// ============================================================
// 统一后端 Hub 与各窗口之间的共享常量、Session 形状与 WebSocket 消息协议。
//
// ⚠️ 本文件被独立守护进程 (daemon.ts / bridge.ts / dashboard.ts) 复用，
//    这些进程运行在 VS Code 扩展宿主之外，因此本文件【绝对不能 import 'vscode'】。
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
exports.WINDOW_TOOLS = exports.WS_PATH = exports.MCP_PATH = exports.HUB_INFO_FILE = exports.DEFAULT_HUB_PORT = void 0;
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/** Hub 守护进程默认监听的固定端口 */
exports.DEFAULT_HUB_PORT = 37650;
/** Hub 启动信息文件：记录端口/鉴权令牌/PID，供窗口与 bridge 发现 Hub */
exports.HUB_INFO_FILE = path.join(os.homedir(), '.trae-harvester-hub.json');
/** 大模型连接的 MCP 路径 */
exports.MCP_PATH = '/mcp';
/** 窗口连接的 WebSocket 路径 */
exports.WS_PATH = '/ws';
/** 窗口侧可被 Hub 反向调用的工具名（去掉 session_id 维度后的本地动作） */
exports.WINDOW_TOOLS = {
    GET_EVIDENCE: 'get_evidence',
    EXPORT_PATCH: 'export_patch',
    GET_GIT_PATCH: 'get_git_patch',
    RUN_ALL_TESTS: 'run_all_tests',
    IMPORT_TEST_PLAN: 'import_test_plan',
    GET_AI_CONTEXT: 'get_ai_context',
    GET_PLAN: 'get_plan',
    GET_TEST_RESULTS: 'get_test_results',
    GET_CHECK_ITEMS: 'get_check_items',
    GET_LOGS: 'get_logs',
};
//# sourceMappingURL=protocol.js.map