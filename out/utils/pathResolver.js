"use strict";
// ============================================================
// Trae Harvester — 动态路径解析工具 (Dynamic Path Resolver)
// ============================================================
// 当工作区名为 app 时，自动定位到同级的 gitdiff/ 或 result/ 目录。
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
exports.resolveOutputPath = resolveOutputPath;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const logger_1 = require("./logger");
/**
 * 解析输出路径。
 * 如果启用了 autoDetectWorkspaceStructure，且工作区目录名称为 'app'（不区分大小写），
 * 则对于 patch 导出使用同级 'gitdiff' 目录，对于 results 导出使用同级 'result' 目录。
 * 否则，使用配置的默认路径。
 */
function resolveOutputPath(type) {
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const configKey = type === 'patch' ? 'patchOutputPath' : 'resultsOutputPath';
    const configuredPath = config.get(configKey, '/gitdiff_shared');
    const autoDetect = config.get('autoDetectWorkspaceStructure', true);
    if (autoDetect && workspaceFolder) {
        // 使用 path.basename 获取当前文件夹名称（如果是 /project/p01/m01/app，则为 app）
        const baseName = path.basename(workspaceFolder);
        if (baseName.toLowerCase() === 'app') {
            const parentDir = path.dirname(workspaceFolder);
            const targetDirName = type === 'patch' ? 'gitdiff' : 'result';
            const resolvedPath = path.join(parentDir, targetDirName);
            (0, logger_1.getLogger)().info('PathResolver', `自动识别工作区结构(app)，解析 ${type} 路径为: ${resolvedPath}`);
            return resolvedPath;
        }
    }
    return configuredPath;
}
//# sourceMappingURL=pathResolver.js.map