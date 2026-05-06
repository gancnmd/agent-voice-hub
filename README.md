# 🎙️ AgentVoiceHub

<p align="center">
  <img src="https://img.shields.io/badge/Version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
  <img src="https://img.shields.io/badge/Python-3.11+-yellow" alt="Python">
  <img src="https://img.shields.io/badge/PRs-Welcome-brightgreen" alt="PRs Welcome">
</p>

**语音驱动的 AI Agent 交互平台** — 用语音控制 OpenClaw、Hermes 等智能体，支持自定义音色、多 Agent 切换、实时对话。

[English](#english) | 中文

---

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 🎙️ **语音输入** | 麦克风实时语音识别（Web Speech API） |
| 🔊 **语音回答** | Edge TTS 多种音色（中文 8 种 + 英文 17 种） |
| 🎨 **自定义音色** | 上传人声音频，创建专属音色 |
| 🤖 **多 Agent** | 支持 OpenClaw、Hermes 及自定义 Agent |
| 💬 **实时对话** | WebSocket 流式通信，打字机效果 |
| 🎯 **快捷键** | 空格键说话、Ctrl+K 搜索、Esc 停止 |
| 📊 **对话历史** | 本地存储，支持导出 |
| 🎵 **音频可视化** | 实时波形显示 |
| 🌐 **科技感 UI** | 深色主题、粒子动画、玻璃拟态 |
| 🛡️ **安全防护** | 输入验证、CORS 配置、API Key 加密存储 |

## 🚀 快速开始

### 环境要求

- Python 3.11+
- Node.js 18+（可选，用于开发）
- 现代浏览器（Chrome/Edge/Firefox）

### 安装

```bash
# 克隆仓库
git clone https://github.com/gancnmd/agent-voice-hub.git
cd agent-voice-hub

# 安装后端依赖
cd backend
pip install -r requirements.txt

# 启动后端
python -m uvicorn main:app --host 0.0.0.0 --port 8765 --reload

# 打开前端（新终端）
cd ../frontend
# 直接用浏览器打开 index.html，或用简易服务器：
python -m http.server 3000
```

### 访问

- 前端页面：http://localhost:3000
- API 文档：http://localhost:8765/docs
- 健康检查：http://localhost:8765/health

## 📁 项目结构

```
agent-voice-hub/
├── backend/
│   ├── main.py              # FastAPI 主服务
│   ├── voice_engine.py      # TTS 语音引擎
│   └── requirements.txt     # Python 依赖
├── frontend/
│   ├── index.html           # 主页面
│   ├── style.css            # 样式文件
│   └── app.js               # 前端逻辑
├── docs/
│   ├── API.md               # API 文档
│   └── DEPLOY.md            # 部署指南
├── .github/
│   └── FUNDING.yml          # 赞助配置
├── LICENSE                  # MIT 许可证
└── README.md                # 本文件
```

## 🔧 配置

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HOST` | `0.0.0.0` | 服务监听地址 |
| `PORT` | `8765` | 服务端口 |
| `OPENCLAW_URL` | `http://127.0.0.1:18789` | OpenClaw Gateway 地址 |
| `HERMES_URL` | `http://127.0.0.1:5000` | Hermes Gateway 地址 |
| `OPENCLAW_TOKEN` | - | OpenClaw Gateway Token |
| `MAX_UPLOAD_SIZE` | `10485760` | 最大上传文件大小（10MB） |
| `SESSION_TTL` | `3600` | 会话超时时间（秒） |

### 音色列表

**中文音色：**
| 音色 ID | 名称 | 性别 |
|---------|------|------|
| `zh-CN-XiaoxiaoNeural` | 晓晓 | 女 |
| `zh-CN-XiaoyiNeural` | 晓伊 | 女 |
| `zh-CN-YunjianNeural` | 云健 | 男 |
| `zh-CN-YunxiNeural` | 云希 | 男 |
| `zh-CN-YunxiaNeural` | 云夏 | 男 |
| `zh-CN-YunyangNeural` | 云扬 | 男 |
| `zh-CN-liaoning-XiaobeiNeural` | 晓北（东北话）| 女 |
| `zh-CN-shaanxi-XiaoniNeural` | 晓妮（陕西话）| 女 |

## 🎨 界面预览

- **深色主题**：#0a0a0f 背景 + #00d4ff 青色强调
- **粒子动画**：Canvas 背景粒子网络
- **玻璃拟态**：毛玻璃效果卡片
- **霓虹光效**：按钮和激活状态的发光效果

## 🛡️ 安全特性

- ✅ 输入验证（所有 API 端点）
- ✅ 文件上传限制（类型、大小）
- ✅ CORS 配置（可限制来源）
- ✅ API Key 不硬编码（环境变量）
- ✅ 会话自动过期
- ✅ WebSocket 连接认证
- ✅ 无敏感信息泄露

## 📝 API 文档

启动后端后访问 http://localhost:8765/docs 查看 Swagger UI 自动生成的 API 文档。

### 主要端点

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/tts/voices` | 获取可用音色 |
| `POST` | `/tts/synthesize` | 文本转语音 |
| `POST` | `/stt/transcribe` | 语音转文本 |
| `POST` | `/agents/openclaw` | 调用 OpenClaw |
| `POST` | `/agents/hermes` | 调用 Hermes |
| `POST` | `/voices/upload` | 上传自定义音色 |
| `WS` | `/ws/voice` | WebSocket 语音交互 |

## 🤝 贡献

欢迎贡献！请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 了解详情。

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/amazing-feature`
3. 提交更改：`git commit -m 'Add amazing feature'`
4. 推送分支：`git push origin feature/amazing-feature`
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Edge TTS](https://github.com/rany2/edge-tts) - 微软 Edge 语音合成
- [FastAPI](https://fastapi.tiangolo.com/) - 现代 Python Web 框架
- [OpenClaw](https://openclaw.ai/) - AI Agent 平台
- [Hermes Agent](https://hermes-agent.nousresearch.com/) - AI Agent 框架

---

<a name="english"></a>
## English

**Voice-controlled AI Agent interaction platform** — Control OpenClaw, Hermes and other AI agents with your voice. Supports custom voices, multi-agent switching, and real-time conversation.

See [documentation](docs/) for details.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/gancnmd">gancnmd</a>
</p>
