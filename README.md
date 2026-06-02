# Trae Harvester (Trae 自动化收割机)

一个为 Trae / Trae CN / VS Code 提供自动化收割功能的插件。

## 主要功能
- 自动化生成并导出 Git Patch
- AI 聊天上下文提取（支持 state.vscdb 影子读取）
- 基于 JSON 测试用例的动态测试执行与结果捕获

## 配置
- `traeHarvester.outputPath`: 输出报告/产物的绝对路径。
- `traeHarvester.stateDbPath`: 数据库 `state.vscdb` 路径（留空则自动识别）。

> 注：本插件在早期的 Remote/DevContainer 场景下也可正常工作（默认使用 Workspace Extension 机制）。
