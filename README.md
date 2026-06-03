# Daidai Live2D Pet 🐱

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

开箱即用的 Live2D 桌面宠物 —— Electron 透明宠物窗 + 系统托盘 + 后台管理 + 多模型支持 + AI 会话状态联动（Codex / Claude Code）。

## 截图

打开应用后，Live2D 角色会出现在桌面右下角，随 AI 会话状态变化动作（思考时歪头、运行工具时打字、回复完成时待机），右上角显示状态气泡。

## ✨ 特性

- **即装即用** — 内置 5 个 Cubism2 模型：Rem、Sagiri、Mashiro、Kanna、Katou
- **模型管理** — 后台管理窗一键导入/切换 Live2D 模型目录
- **系统托盘** — 显示/隐藏宠物、打开管理、退出
- **AI 状态联动** — 监听 Codex/Claude Code 会话，自动切换 Live2D 动作（思考/工作/回复/待机）
- **状态气泡** — 实时显示 AI 当前状态，支持中文
- **鼠标交互** — 拖动宠物、眼镜跟随鼠标
- **透明窗口** — 无边框透明置顶，不挡工作区
- **内置状态桥** — 端口 23334，兼容 ClaudePet 协议

## 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/Rosa134/daidai-live2d-pet.git
cd daidai-live2d-pet

# 2. 安装依赖
npm install

# 3. 启动
npm start
```

如果 Electron 下载慢，先设置镜像：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm install
```

启动后：
- 系统托盘中出现猫耳图标
- 右键托盘 → 「设置」打开管理窗口
- 管理窗口中可选择/导入模型
- 宠物自动监听 `http://127.0.0.1:23334/status` 获取 AI 状态

## 接入 AI 会话

宠物内置了状态桥（端口 23334），兼容 ClaudePet 协议：

```bash
# 查看当前状态
curl http://127.0.0.1:23334/status

# 推送事件
curl -X POST http://127.0.0.1:23334/event -H "Content-Type: application/json" -d '{"kind":"thinking","text":"思考中..."}'
```

Codex 用户：宠物自动监听 `.codex/sessions/*.jsonl`，无需手动配置。
Claude Code 用户：参考 [ClaudePet](https://github.com/Kodey/ClaudePet) 的 hook 配置。

## 导入模型

1. 打开管理窗口（托盘 → 设置）
2. 点击「导入 Live2D 目录」
3. 选择包含 `.model.json`（Cubism2）的目录
4. 模型会复制到 `%APPDATA%/daidai-live2d-pet/models/`

支持的格式：Cubism2（`.model.json`）。Cubism3+（`.model3.json`）暂不支持。

## 内置模型来源

| 模型 | 角色 | 来源 |
|------|------|------|
| rem | 蕾姆（Re:Zero） | [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) |
| sagiri | 紗霧（エロマンガ先生） | [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) |
| mashiro | 椎名真白（さくら荘） | [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) |
| kanna | カンナ（小林さんちのメイドラゴン） | [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) |
| katou | 加藤恵（冴えない彼女の育てかた） | [Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model) |

## 开发

```bash
npm install
npm test          # 运行测试
npm run doctor    # 检查关键文件
npm start         # 启动应用
npm run dev       # 开发模式（带 DevTools）
```

### 项目结构

```
├── src/
│   ├── main/           # Electron 主进程
│   │   ├── main.js          # 窗口管理、托盘、IPC
│   │   ├── config-store.js  # 配置持久化
│   │   ├── model-registry.js# 模型注册表
│   │   ├── status-bridge.js # 内置 23334 状态桥
│   │   ├── status-poller.js # 状态轮询 + 归一化
│   │   └── codex-session-monitor.js # Codex JSONL 监听
│   ├── renderer/       # 渲染进程
│   │   ├── app.js           # Live2D 加载、气泡、状态联动、鼠标交互
│   │   ├── index.html       # 入口（管理窗 + 宠物窗）
│   │   ├── styles.css       # 样式
│   │   └── vendor/          # PIXI + Cubism2 runtime
│   └── preload.js      # contextBridge IPC
├── tests/              # 单元测试
├── scripts/            # 工具脚本
├── user-data/models/   # 预制模型
└── bin/                # CLI 入口
```

## 参考与致谢

本项目受以下开源项目启发，部分 vendor 文件来源于这些项目：

- **[ClaudePet](https://github.com/Kodey/ClaudePet)** — 原始 Live2D 桌宠概念和状态协议，本项目继承了其 23334 端口协议和透明窗设计理念
- **[pixi-live2d-display](https://github.com/guansss/pixi-live2d-display)**（MIT）— PixiJS Live2D 渲染插件，vendor 目录中的 `live2d.min.js`、`cubism2.min.js`、`cubism4.min.js` 来自此项目
- **[PixiJS](https://github.com/pixijs/pixijs)**（MIT）— 2D WebGL 渲染引擎
- **[Live2D Cubism SDK](https://www.live2d.com/)** — Live2D 技术核心，`live2dcubismcore.min.js` 来自官方 SDK
- **[Eikanya/Live2d-model](https://github.com/Eikanya/Live2d-model)** — 开源 Live2D 模型合集，内置 5 个 Cubism2 模型来源于此

## License

MIT © Daidai contributors

本项目代码采用 MIT 协议。内置 Live2D 模型文件版权归原作者所有，仅供学习和研究使用。
