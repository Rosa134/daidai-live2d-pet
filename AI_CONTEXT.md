# AI_CONTEXT

## 需求分析

老公想把当前 Live2D 宠物产品化，目标是像 ClaudePet 一样有后台应用管理：可以开启、关闭、选择、导入 Live2D 形象，并具备开源后其他人快速使用的基础。

## 关键边界

- 成熟宠物项目不动：`D:\呆呆工作区\其他项目\ClaudePet`
- 新项目路径：`D:\呆呆工作区\代码项目\daidai-live2d-pet`
- 开源优先：不能默认打包版权不清的 Rem 等模型
- 当前阶段先做产品壳和模型管理，再迁移 AI 状态联动

## 成功标准

- 新项目可独立运行 Electron
- 管理窗可导入并选择 Live2D 模型目录
- 宠物窗可显示所选模型或清晰空状态
- 后续 adapter 可接入 Codex / Claude Code，且状态不串源

## 前端体验门控

- 触发：后台管理窗口、透明宠物窗口、模型导入工作流
- 本阶段选择：先实现朴素可用版本，后续再补设计稿和更完整 UI

## 方案

采用 Electron 双窗口：

- Pet Window：透明、置顶、显示 Live2D 和气泡
- Manager Window：普通窗口，管理模型、配置、开关
- Tray：常驻入口，控制显示/隐藏/退出
- Model Registry：在 userData 中维护模型列表，导入时复制模型目录
- Status Adapter：独立轮询模块，后续接 Codex JSONL、Claude Code hook、HTTP bridge
