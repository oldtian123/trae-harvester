// ============================================================
// Trae Harvester — Docker 容器命令执行 (Docker Exec Helper)
// ============================================================
// 评测时 VM 本身没有运行环境，命令需要在对应的 Docker 容器里执行。
// 容器命名形如：multide-run-<user>-<project>-p01-m05
//   - 前缀（multide-run-...-<project>）会变，不可硬编码
//   - 尾部 -p<轮次>-m<模型顺序> 是稳定锚点
//   - 同一时刻只存在当前轮次的 5 个容器，轮次 p 自动跟随，无需人工指定
//
// 定位逻辑：docker ps 列出运行中容器 → 正则匹配尾缀 -p\d+-m0?<X> → 唯一命中即用。
// 找不到 / 多个 / docker 不可用 → 抛错（硬失败），由调用方标记步骤为 ERROR。

import { spawn } from 'child_process';
import { CommandResult } from '../types';

/**
 * 列出当前运行中的容器名（docker ps）。
 * docker 不可用或调用失败时抛错。
 */
export function listRunningContainers(): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['ps', '--format', '{{.Names}}'], { shell: false });
        let stdout = '';
        let stderr = '';
        child.stdout?.on('data', d => stdout += d.toString());
        child.stderr?.on('data', d => stderr += d.toString());
        child.on('error', (err) => {
            reject(new Error(`无法执行 docker（请确认 docker 已安装且在 PATH 中）: ${err.message}`));
        });
        child.on('close', (code) => {
            if (code !== 0) {
                reject(new Error(`docker ps 执行失败 (exit=${code}): ${stderr.trim()}`));
                return;
            }
            const names = stdout
                .split('\n')
                .map(s => s.trim())
                .filter(s => s.length > 0);
            resolve(names);
        });
    });
}

/**
 * 在运行中的容器里，按模型顺序号匹配目标容器名。
 * 仅依据尾部 -p<轮次>-m<模型顺序> 匹配（轮次任意，模型顺序须等于 modelOrder）。
 *
 * @param containers  docker ps 得到的容器名列表
 * @param modelOrder  模型顺序号（1-based，对应容器名里的 m0X）
 * @returns           唯一命中的容器名
 * @throws            0 个或多个命中时抛错
 */
export function matchContainerByModelOrder(containers: string[], modelOrder: number): string {
    // 容器尾缀形如 -p01-m05；m 后允许有/无前导 0，宽松匹配模型序号
    const re = new RegExp(`-p\\d+-m0*${modelOrder}$`);
    const matched = containers.filter(name => re.test(name));

    if (matched.length === 0) {
        throw new Error(
            `未找到模型顺序 m${String(modelOrder).padStart(2, '0')} 对应的运行中容器。` +
            `该轮次容器可能尚未创建或已被销毁。当前运行容器: [${containers.join(', ') || '无'}]`
        );
    }
    if (matched.length > 1) {
        throw new Error(
            `匹配到多个模型顺序为 m${String(modelOrder).padStart(2, '0')} 的容器: [${matched.join(', ')}]，无法确定目标。`
        );
    }
    return matched[0];
}

/**
 * 重启指定容器（docker restart）。
 * @returns 成功时 resolve，失败时 reject（带 stderr）。
 */
export function restartContainer(container: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const child = spawn('docker', ['restart', container], { shell: false });
        let stderr = '';
        child.stderr?.on('data', d => stderr += d.toString());
        child.on('error', (err) => {
            reject(new Error(`无法执行 docker restart: ${err.message}`));
        });
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`docker restart 失败 (exit=${code}): ${stderr.trim()}`));
            }
        });
    });
}

/**
 * 解析 dockerShell 配置（如 "sh -lc"）为 [shell, ...flags]。
 */
function parseShell(shellConfig: string): string[] {
    const parts = shellConfig.trim().split(/\s+/).filter(Boolean);
    return parts.length > 0 ? parts : ['sh', '-lc'];
}

/**
 * 在指定容器内执行命令：docker exec -w <workdir> <container> <shell...> <command>。
 * 使用数组传参（shell:false），原命令作为单一参数原样进容器，避免双层 shell 转义问题。
 *
 * @param container   目标容器名
 * @param command     要在容器内执行的原始命令字符串
 * @param workdir     容器内工作目录
 * @param shellConfig 容器内 shell（如 "sh -lc"）
 * @param timeoutMs   超时时间(ms)，0 表示不超时
 */
export function execInContainer(
    container: string,
    command: string,
    workdir: string,
    shellConfig: string,
    timeoutMs: number = 0
): Promise<CommandResult> {
    return new Promise((resolve) => {
        const shellParts = parseShell(shellConfig);
        const args = ['exec', '-w', workdir, container, ...shellParts, command];

        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let settled = false;

        const child = spawn('docker', args, { shell: false });

        let timer: NodeJS.Timeout | undefined;
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true;
                child.kill('SIGTERM');
                setTimeout(() => { if (!settled) child.kill('SIGKILL'); }, 5000);
            }, timeoutMs);
        }

        child.stdout?.on('data', (d: Buffer) => stdout += d.toString());
        child.stderr?.on('data', (d: Buffer) => stderr += d.toString());

        child.on('close', (code) => {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({ stdout, stderr, exitCode: code, timedOut });
        });

        child.on('error', (err) => {
            settled = true;
            if (timer) clearTimeout(timer);
            resolve({
                stdout,
                stderr: stderr + `\n[docker exec 启动失败] ${err.message}`,
                exitCode: -1,
                timedOut: false,
            });
        });
    });
}
