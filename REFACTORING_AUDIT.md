# Trae Harvester Extension — 全面代码审计与重构参考报告

这份报告是对 Trae Harvester VS Code 插件（v0.5.0-beta）所有 13 个核心文件的详尽代码审计结果。旨在为接下来的重构任务提供完整的功能清单、依赖关系以及已发现的代码异味（Code Smells），方便接手的 Agent 快速理解当前系统。

---

## 1. package.json — 插件清单

### 已注册命令 (10个)
| 命令 ID | 标题 |
|---|---|
| `trae-harvester.exportPatch` | Export Git Patch (导出分支 Patch) |
| `trae-harvester.inputTestSteps` | Input Test Steps JSON (输入测试步骤) |
| `trae-harvester.runAllTests` | Run All Tests (一键全自动执行测试) |
| `trae-harvester.runSingleStep` | Run Single Test Step (单步执行测试) |
| `trae-harvester.harvestAll` | Harvest All (一键收割全部产物) |
| `trae-harvester.runDiagnostics` | Run Diagnostics (运行环境诊断) |
| `trae-harvester.showLogs` | Show Logs (显示运行日志) |
| `trae-harvester.exportLogs` | Export Logs (一键导出运行日志) |
| `trae-harvester.copyRouterCommand` | Copy MCP Router Command (复制统一路由命令) |
| `trae-harvester.showGlobalStatus` | Show Global Status Dashboard (全局多窗口状态大屏) |

### 配置项 (8个)
| 键名 | 默认值 | 描述 |
|---|---|---|
| `traeHarvester.patchOutputPath` | `/gitdiff_shared` | Git Patch 产物的绝对导出路径 |
| `traeHarvester.resultsOutputPath` | `/gitdiff_shared` | 测试结果 JSON 产物的绝对导出路径 |
| `traeHarvester.commandTimeout` | `300000` | 命令执行超时时间(毫秒), 默认5分钟 |
| `traeHarvester.mcpPort` | `3000` | MCP Server 监听的本地首选端口 |
| `traeHarvester.modelOptions` | `["GPT-4o", ...]` | 测试面板中可选的大模型标识列表 |
| `traeHarvester.promptOptions` | `["Prompt_V1", ...]`| 测试面板中可选的提示词版本标识列表 |
| `traeHarvester.mcpAllowExecution` | `true` | 是否允许通过 MCP 协议执行自动化测试或导入测试计划 |
| `traeHarvester.githubToken` | `""` | GitHub Personal Access Token for git push auth |

### 视图与容器
- **Activity Bar Container**: `trae-harvester-sidebar` (侧边栏图标)
- **Webview View**: `trae-harvester.testPanel` (Test Steps 视图)

---

## 2. 核心入口：extension.ts

### 初始化流程
1. 初始化统一 Logger
2. 注册 `exportPatch` 命令
3. 注册测试相关命令 (`inputTestSteps`, `runAllTests`, `runSingleStep`, `exportResults`)
4. 注册 Webview (`TestPanelProvider`)
5. 启动内嵌 MCP Server (`startMcpServer()`)
6. 注册 `harvestAll` 组合命令
7. 注册诊断命令 (`runDiagnostics`, `showLogs`, `exportLogs`)
8. 注册辅助命令 (`checkForUpdates`, `copyRouterCommand`, `showGlobalStatus`)
9. 触发静默自动更新检查

---

## 3. 测试引擎：testRunner.ts

负责测试步骤的编排、执行与状态管理。

- **模块级全局状态**：持有 `currentPlan` (当前计划), `stepResults` (执行结果), `webviewRef` (UI引用), `currentAiContext` (AI上下文)。
- **关键导出函数**：
  - `updatePlanIdentifiers`：更新计划的 model/prompt 标识并同步到注册表。
  - `importTestPlanJson`：解析 JSON 导入测试计划（供 MCP 调用）。
  - `addStepToPlan` / `addCheckItemToPlan`：动态添加步骤和检查项。
  - `getTestResultsForEvidence`：组装完整的评测证据供导出。
- **内部核心机制**：
  - `executeStep`：通过 `child_process` 执行 shell 命令并捕获输出。
  - `sanitizeText`：脱敏控制台输出，过滤敏感的 GitHub Token。
  - `saveHistorySnapshot`：测试完成后将结果和 Git Patch 打包存入 `.trae_harvester_history/`。

---

## 4. MCP 服务端：mcpServer.ts

为外部（大模型）提供通过 HTTP/SSE 协议交互的接口。

### 安全机制
- 强制绑定 `127.0.0.1`
- `/mcp` 路由强制校验 `Authorization: Bearer <token>`
- Token 为启动时 `crypto.randomBytes(32)` 生成

### 暴露的 Resource（只读，共5个）
- `harvester://state/ai-context`：AI 思考上下文
- `harvester://state/logs`：插件运行日志
- `harvester://state/plan`：当前测试计划
- `harvester://state/test-results`：测试执行结果
- `harvester://state/check-items`：人工检查项状态

### 提供的 Tool（模型可用工具，共6个）
- `trea_harvester_import_test_plan` (⚠️ 受 mcpAllowExecution 控制)
- `trea_harvester_run_all_tests` (⚠️ 受 mcpAllowExecution 控制)
- `trea_harvester_export_patch`
- `trea_harvester_get_evaluation_evidence`
- `trea_harvester_get_git_patch`
- `trea_harvester_test_connection`

---

## 5. 多窗口路由与监控

### 目录式注册表 (`utils/registry.ts`)
- 废弃了单文件，采用 `~/.trae-harvester-registry/<port>.json` 结构。
- 每个窗口启动时生成 Auth Token，每 15 秒打一次心跳。
- 自动清理超过 60 秒未心跳或进程已死亡的过期文件。

### 聚合路由器 (`out/mcp-router.js`)
- 独立的 Node.js 脚本，作为统一入口。
- 扫描注册表目录，提供 `trea_harvester_list_windows` 和 `trea_harvester_get_evidence` 两个工具。
- 代理请求时，自动从对应窗口的 `.json` 文件中读取 Auth Token 并注入 HTTP Header。

### 状态大屏 (`out/status-dashboard.js`)
- 独立 CLI 脚本，每 2 秒扫描一次注册表目录。
- 在终端打印包含 PORT, PID, STATUS, AUTH, MODEL, PROMPT, WORKSPACE 的实时表格。

---

## 6. 其他辅助模块

- **`gitPatch.ts`**：执行 git stash, commit, push, diff 等一系列命令以生成对比 Patch。
- **`diagnostics.ts`**：收集操作系统、VS Code 版本、Node 版本等用于排查问题。
- **`logger.ts`**：封装 Output Channel、Status Bar 和临时文件日志写入。
- **`autoUpdater.ts`**：通过访问 GitHub 上的 package.json 检查版本，自动下载并安装新版 VSIX。
- **`testPanelProvider.ts` / `media/testPanel.js`**：负责侧边栏的 Webview 渲染和双向通信（超过 20 种事件类型）。

---

## 🚨 重构建议与已知代码异味 (Code Smells)

接手重构的 Agent 请特别注意以下问题：

1. **未在 package.json 声明的隐藏命令**
   - `trae-harvester.checkForUpdates` 和 `trae-harvester.exportResults` 在代码中被注册，但未在 package.json 的 `contributes.commands` 中声明，导致无法从命令面板(Command Palette)调用。
2. **配置键名拼写错误**
   - `diagnostics.ts` 第 51 行和 `extension.ts` 第 95 行错误地读取了 `config.get('outputPath')`，而 package.json 中定义的是 `patchOutputPath` 和 `resultsOutputPath`。
3. **重复的 Output Channel 创建**
   - `logger.ts` 中创建了名为 "Trae Harvester Log" 的频道；而 `gitPatch.ts` 中每次导出 Patch 都会使用 `vscode.window.createOutputChannel('Trae Harvester')` 重复创建新的实例。
4. **延迟加载 (Lazy Require) 滥用**
   - 大量方法内部使用了局部 `require('../xxx')`，而不是顶层 `import`。虽能避免循环依赖，但严重降低了代码可读性与类型推断能力。
5. **模块级全局状态过多**
   - `testRunner.ts` 将许多核心状态（如 `currentPlan`, `stepResults`）设为模块顶层变量，导致难以编写单元测试，也破坏了高内聚原则。建议将测试执行逻辑封装为 `TestSession` 类。
