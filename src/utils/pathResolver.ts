// ============================================================
// Trae Harvester — 动态路径解析工具 (Dynamic Path Resolver)
// ============================================================
// 当工作区名为 app 时，自动定位到同级的 gitdiff/ 或 result/ 目录。

import * as vscode from 'vscode';
import * as path from 'path';
import { getLogger } from './logger';

/**
 * 解析输出路径。
 * 如果启用了 autoDetectWorkspaceStructure，且工作区目录名称为 'app'（不区分大小写），
 * 则对于 patch 导出使用同级 'gitdiff' 目录，对于 results 导出使用同级 'result' 目录。
 * 否则，使用配置的默认路径。
 */
export function resolveOutputPath(type: 'patch' | 'results'): string {
    const config = vscode.workspace.getConfiguration('traeHarvester');
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    const configKey = type === 'patch' ? 'patchOutputPath' : 'resultsOutputPath';
    const configuredPath = config.get<string>(configKey, '/gitdiff_shared');
    const autoDetect = config.get<boolean>('autoDetectWorkspaceStructure', true);
    
    if (autoDetect && workspaceFolder) {
        // 使用 path.basename 获取当前文件夹名称（如果是 /project/p01/m01/app，则为 app）
        const baseName = path.basename(workspaceFolder);
        if (baseName.toLowerCase() === 'app') {
            const parentDir = path.dirname(workspaceFolder);
            const targetDirName = type === 'patch' ? 'gitdiff' : 'result';
            const resolvedPath = path.join(parentDir, targetDirName);
            
            getLogger().info('PathResolver', `自动识别工作区结构(app)，解析 ${type} 路径为: ${resolvedPath}`);
            return resolvedPath;
        }
    }
    
    return configuredPath;
}
