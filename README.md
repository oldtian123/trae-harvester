# Trae Harvester (Trae 自动化收割机) 🚜

**Trae Harvester** 是一个专为 VS Code / Trae 打造的“AI 评估与人工监考”桥梁扩展。它内置了一个强大的 MCP (Model Context Protocol) Server，使得具有 Agent 能力的大语言模型（如 Codex 等）可以直接接管测试编排，并自动“收割”所有的测试证据以进行打分。

它完美契合了 **“AI 填表 -> 人工监考 -> AI 收卷评分”** 的终极工作流。

---

## 🌟 核心特性 (Features)

- **内置 MCP Server 无缝连接**
  通过标准的 MCP 协议（启动于 `http://localhost:3000/mcp`），外部大模型可直接与 VS Code 侧边栏进行通信，全权指挥测试用例的下发与证据收集。
- **自动化测试编排与执行**
  支持通过 JSON 格式下发命令行测试步骤，大模型或用户一键即可在终端全自动按序跑完所有测试，并自动捕获每一条命令的报错日志、退出码与执行耗时。
- **人工 UI 监考机制**
  对于大模型无法直接看到的页面样式、前端交互等问题，大模型可以下发“人工检查项”。你只需在侧边栏打勾，最终结果会一并提供给评分模型。
- **自动导出 Git Patch**
  不仅能跑测试，还能一键导出当前工作区相对于 `main` 分支的物理 `.patch` 文件，用作最终代码评审的依据。
- **静默自动更新 (Auto-Updater)**
  插件每次启动会自动检测云端（GitHub）是否发布了新版，支持通过 UI 按钮手动“检查更新”，并提供进度条静默下载安装体验。

---

## 🤖 MCP 工具箱 (For AI Agents)

只要让你的大模型客户端连接到本插件的 MCP 端口，模型将自动解锁以下专属强力工具（所有工具均前缀 `trea_harvester_` 以确保精准语义发现）：

| 工具名称 (Tool) | 描述 |
| --- | --- |
| `trea_harvester_import_test_plan` | 导入完整的测试计划 JSON，自动在 Webview 渲染终端测试步骤和人工验收项。 |
| `trea_harvester_run_all_tests` | 触发一键执行，在终端后台全自动跑完所有已配置的命令。 |
| `trea_harvester_export_patch` | 自动执行 Git 命令导出当前补丁，返回文件路径。 |
| `trea_harvester_get_evaluation_evidence`| **终极收卷工具**：将 AI上下文、Git Patch 内容、测试运行结果、人工勾选状态打包拼装成一份完整的 JSON 数据用于最终评分！|
| `trea_harvester_test_connection` | 探针测试，验证与 Trae Harvester 的双向通信是否健康。 |

**可供读取的上下文资源 (Resources)：**
大模型也可以随时读取状态数据：
- `harvester://state/ai-context` (模型思考过程)
- `harvester://state/plan` (当前编排表)
- `harvester://state/test-results` (当前执行结果)
- `harvester://state/check-items` (人工勾选状态)
- `harvester://state/logs` (插件底层的调试日志)

---

## ⚙️ 配置项 (Settings)

你可以在 VS Code 的设置 (`settings.json`) 中搜索 `Trae Harvester` 来调整以下参数：

- `traeHarvester.patchOutputPath`: 生成的 `.patch` 物理文件导出的绝对路径（默认: `/gitdiff_shared`）。
- `traeHarvester.resultsOutputPath`: 生成的测试结果及上下文报告 `test_result.json` 的导出路径（默认: `/gitdiff_shared`）。
- `traeHarvester.commandTimeout`: 终端执行单条测试命令的超时时间（单位：毫秒，默认 `300000` 即 5 分钟）。

---

## 🚀 快速上手 (Quick Start)

1. **安装**：通过 VSIX 安装此扩展。
2. **打开面板**：点击侧边栏的 🚜 **Test Steps** 图标，打开工具箱。
3. **启动 MCP**：点击 `🔴 启动 MCP`，变成绿灯后，在你的 AI IDE (如 Cursor/Trae/Codex) 里配置 MCP 地址 `http://localhost:3000/mcp`。
4. **尽情调遣**：在聊天框告诉模型：“请用 trea_harvester_import_test_plan 下发测试计划”，模型将全自动接管流程！
