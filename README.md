# AI Prompt Project

一个基于 Vite + React 的 AI 视频运镜提示词工具。应用支持创建多个提示词项目、上传参考图片、通过对话整理需求，并生成可复制的中英文视频运镜 Prompt。

## 主要功能

- 多项目管理：新建、搜索、切换和删除提示词项目。
- 参考图上传：支持点击、拖拽、粘贴图片，最多 10 张，每张不超过 10MB。
- 对话式生成：在中间区域输入需求，应用会汇总需求并更新右侧最终结果。
- 中英文 Prompt：生成中文 Prompt 和 English Prompt，并支持一键复制。
- 历史记录：保留当前项目的历史生成结果，方便回看和恢复。
- API 配置：可在页面右上角配置 OpenAI Compatible 接口、模型名称和 API Key；未配置 API Key 时会使用本地模拟生成。

## 环境要求

- Node.js 18 或更高版本
- npm 9 或更高版本

## 本地启动

```powershell
npm install
npm run dev
```

启动后在浏览器打开终端显示的本地地址，通常是：

```text
http://localhost:5173
```

## 构建生产版本

```powershell
npm run build
```

如需本地预览构建结果：

```powershell
npm run preview
```

## 环境变量

复制 `.env.example` 为 `.env` 后可以设置默认模型服务信息：

```powershell
Copy-Item .env.example .env
```

不要把真实 API Key 提交到 GitHub。当前应用默认把 API Key 保存在浏览器本地存储中，也可以在 `.env` 中使用 `VITE_DEFAULT_API_KEY` 仅用于本地开发。

## 依赖文件

这是一个前端项目，依赖记录在：

- `package.json`
- `package-lock.json`

本项目不需要 `requirements.txt`。如果后续加入 Python 后端或脚本，再添加 `requirements.txt`。

## 给新电脑上的 Codex

新电脑继续开发时：

```powershell
git clone <your-repo-url>
cd ai-prompt-project
npm install
npm run dev
```

项目入口文件：

- `src/App.jsx`：主要应用逻辑和界面。
- `src/main.jsx`：React 挂载入口。
- `src/style.css`：全局样式。
