# Daidai Live2D Pet 🐱

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/node-18%2B-green.svg)](https://nodejs.org/)

开箱即用的 Live2D 桌面宠物。它把 Electron 透明宠物窗、系统托盘、后台管理、多模型导入、AI 会话状态提醒、角色聊天、TTS 语音、口型同步和随机肢体动作放在一个桌面应用里。

项目默认服务于两种共存场景：

- **工作提醒模式**：监听 Codex / Claude Code 状态，在角色头顶显示中文气泡，并根据思考、运行工具、回复、完成等状态切换动作。
- **角色陪伴模式**：底部输入框直接和角色聊天，支持 OpenAI 兼容文本接口、火山引擎 TTS、角色卡提示词、音色配置、语音播放时的口型同步和随机说话动作。

## 截图

打开应用后，Live2D 角色会出现在桌面右下角。AI 工作状态会显示在角色上方，角色聊天输入框显示在底部；语音播放时嘴型会跟随音频 RMS 变化，并穿插模型已有的说话/待机动作。

## ✨ 特性

- **即装即用** — 内置 5 个 Cubism2 模型：Rem、Sagiri、Mashiro、Kanna、Katou
- **模型管理** — 后台管理窗一键导入/切换 Live2D 模型目录
- **系统托盘** — 显示/隐藏宠物、打开管理、退出
- **AI 状态联动** — 监听 Codex/Claude Code 会话，自动切换 Live2D 动作（思考/工作/回复/待机）
- **状态气泡** — 实时显示 AI 当前状态，支持中文
- **角色聊天** — 底部输入框发起独立聊天会话，和 Codex/Claude 状态提醒互不干扰
- **模型与语音配置** — 管理页可配置 OpenAI 兼容文本接口、模型 ID、角色卡、火山 TTS Token、音色和语速
- **语音与口型同步** — TTS 播放时使用 Web Audio RMS 驱动 `ParamMouthOpenY`，嘴型随语音强弱变化
- **随机肢体动作** — 待机和说话时从当前模型已有 motion 中抽样播放，避免不同模型动作名不一致导致报错
- **动作音效** — 每个状态动作可独立选择音效，也可使用项目级声音目录随机播放
- **鼠标交互** — 拖动宠物、眼睛跟随鼠标
- **透明窗口** — 无边框透明置顶，不挡工作区
- **内置状态桥** — 端口 23334，兼容 ClaudePet 协议

## 快速开始

需要 Node.js 18+ 和 Git。国内用户建议先设置 Electron 镜像再安装：

```powershell
# 1. 克隆仓库
git clone https://github.com/Rosa134/daidai-live2d-pet.git
cd daidai-live2d-pet

# 2. 设置 Electron 镜像（国内网络必须，否则二进制下载会失败）
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"

# 3. 安装依赖（含 Electron 二进制下载）
npm install

# 4. 启动
npm start
```

### 启动常见问题

**`'electron' 不是内部或外部命令`**：Electron 二进制没下载成功，重新安装：

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
node node_modules/electron/install.js
```

**`npm start` 报 script-shell 错误**：重置 npm 的 script-shell：

```powershell
npm config set script-shell "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe"
```

**Electron GPU 缓存权限警告**（`Unable to move the cache`）：不影响功能，可忽略。

启动后：
- 系统托盘中出现猫耳图标
- 右键托盘 → 「设置」打开管理窗口
- 管理窗口中可选择/导入模型
- 宠物自动监听 `http://127.0.0.1:23334/status` 获取 AI 状态
- 如需角色聊天，在管理窗口配置文本模型 API Key 和火山 TTS Token

## 配置密钥

密钥不会写入源码。应用会优先读取本机运行时配置，其次读取环境变量：

| 用途 | 管理页字段 | 环境变量回退 |
|------|------------|--------------|
| 文本模型 API Key | 文字 API Key | `DEEPSEEK_API_KEY` 或 `OPENAI_API_KEY` |
| 火山 TTS Token | 火山 Token | `VOLCENGINE_TOKEN` |

本机配置文件位于 Electron `userData` 目录下的 `config.json`。仓库 `.gitignore` 已忽略 `user-data/config.json`、日志和临时音频文件；公开提交前仍建议运行密钥扫描。

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

## 角色聊天与语音

管理窗口的「聊天模型与角色卡」区域可配置：

- OpenAI 兼容 `/chat/completions` 地址
- 文本模型 ID，默认 `deepseek-chat`
- 角色卡提示词，默认要求只输出角色要说的话，便于直接 TTS
- 火山引擎 TTS AppID、Token、音色、语速

每次应用启动都会开启一个新的本地聊天上下文。聊天输出不占用 Codex/Claude 状态气泡；TTS 播放时会驱动嘴型和随机说话动作。

## 导入模型

1. 打开管理窗口（托盘 → 设置）
2. 点击「导入 Live2D 目录」
3. 选择包含 `.model.json`（Cubism2）的目录
4. 模型会复制到 `%APPDATA%/daidai-live2d-pet/models/`

支持的格式：当前稳定路径优先支持 Cubism2（`.model.json`）。Cubism3+（`.model3.json`）仍在验证中，不建议作为公开默认模型。

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
│   │   ├── app.js           # Live2D 加载、气泡、状态联动、聊天、口型、鼠标交互
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
- **[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)** — 参考其 LLM / TTS / Live2D 伴侣思路
- **[live2d-py](https://github.com/Arkueid/live2d-py)** — 参考 RMS 音频强度映射到嘴型参数的口型同步方案

## License

MIT © Daidai contributors

本项目代码采用 MIT 协议。内置 Live2D 模型文件版权归原作者所有，仅供学习和研究使用。
