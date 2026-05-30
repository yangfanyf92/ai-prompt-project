# AGENTS.md

## 强规则

- 所有回复、提示、错误说明、代码注释、工具调用结果，都必须使用简体中文。
- 禁止使用英文，除非用户明确要求英文。
- 保持专业、清晰的表达，不要夹杂中英文混合内容。

## 项目概览

- 项目名称：`ai-prompt-project`
- 项目类型：基于 Vite 与 React 的单页前端应用
- 核心用途：用于生成 AI 视频运镜提示词，支持上传参考图、通过对话逐步整理需求，并输出可直接复制的中英文提示词
- 当前状态：
- 已完整实现的功能页只有 `cameraPrompts`
- `imagePrompts`、`angles14`、`storyDerivation` 目前还是占位页
- 绝大多数业务逻辑集中在 `src/App.jsx`

## 技术栈

- 运行环境：Node.js 18 或更高版本
- 构建工具：Vite 5
- 前端框架：React 18
- 图标库：`react-icons`
- 样式方案：原生 CSS，主要集中在 `src/style.css`
- 数据持久化：浏览器 `localStorage`
- 接口方式：浏览器直接请求兼容 OpenAI 的模型接口

## 关键文件说明

- `package.json`
- 项目脚本入口，包含 `dev`、`build`、`preview`
- `src/main.jsx`
- React 挂载入口
- `src/App.jsx`
- 主应用文件，包含页面状态、项目管理、图片上传、提示词生成、接口设置、历史记录、占位页切换等主要逻辑
- `src/style.css`
- 全局样式与主要页面样式
- `.env.example`
- 本地环境变量模板
- `preview-site/`
- 构建产物目录，不是源码主编辑区

## 启动方式

### 安装依赖

```powershell
npm install
```

### 启动本地开发

```powershell
npm run dev
```

默认地址通常是：

```text
http://localhost:5173
```

### 构建生产版本

```powershell
npm run build
```

### 本地预览构建结果

```powershell
npm run preview
```

## 环境变量说明

项目在没有真实密钥时也能运行，因为内置了本地模拟生成逻辑。

`.env.example` 中可以看到以下变量：

- `VITE_DEFAULT_PROVIDER`
- `VITE_DEFAULT_ENDPOINT`
- `VITE_DEFAULT_MODEL`
- `VITE_DEFAULT_API_KEY`

注意事项：

- 真实密钥不要提交到仓库
- 当前接口设置主要保存在浏览器 `localStorage` 中
- 即使 `.env` 中没有配置密钥，项目也可以通过本地模拟逻辑继续使用

## 页面与工作流

### 主流程

1. 用户创建或切换项目
2. 用户上传参考图
3. 用户在中间输入区描述需求
4. 应用根据配置决定走真实接口或本地模拟生成
5. 中间区域展示需求总结
6. 右侧展示中文提示词、英文提示词和历史记录

### 功能页结构

功能页定义在 `src/App.jsx` 的 `FEATURE_PAGES` 中：

- `cameraPrompts`：已实现
- `imagePrompts`：占位页
- `angles14`：占位页
- `storyDerivation`：占位页

目前真正可继续开发和维护的核心功能都在 `cameraPrompts` 页面。

## 关键业务规则

### 分镜模板

模板定义在 `src/App.jsx` 的 `STORYBOARD_TEMPLATES` 中。

当前有两个模板：

- `default`：正常输出完整提示词
- `split`：强制按分镜拆分输出

其中 `split` 是严格规则模板，要求非常明确：

- 中文输出必须拆成多个镜头段落
- 每段必须包含固定字段名
- 字段顺序不能改
- 末尾必须追加参考图使用建议
- 英文输出也要做对应拆分

后续修改提示词逻辑时，不要破坏 `split` 模板的输出约束。

### 项目数据结构

项目对象由 `createProject()` 生成，核心字段包括：

- `id`
- `name`
- `createdAt`
- `images`
- `messages`
- `result`
- `history`

### 本地存储键名

在 `src/App.jsx` 中：

- `STORAGE_KEY = 'video-camera-prompt-projects-v1'`
- 用于保存项目列表、消息、图片、结果、历史记录
- `SETTINGS_KEY = 'video-camera-prompt-settings-v2'`
- 用于保存 Provider 配置和当前激活的 Provider

修改数据结构时要考虑旧数据兼容性，避免已有本地项目失效。

## 接口与模型配置

Provider 预设定义在 `src/App.jsx` 的 `PROVIDERS` 中。

当前支持：

- `viva_gpt`
- `viva_claude`
- `openai`
- `deepseek`
- `qwen`
- `custom`

相关核心逻辑：

- 健康检查：`checkHealth()`、`buildHealthEndpoint()`
- 正式生成：`callModel()`、`buildEndpoint()`
- 请求方式：前端直接使用 `fetch`

重要说明：

- 当前仓库没有真正使用中的后端服务
- 设置面板里有 `backendUrl` 字段，但当前主流程没有实际使用它
- 如果后续接后端，不要直接假设这是已完成能力，要先确认设计意图

## 图片上传与处理

图片处理全部在前端完成。

限制条件：

- 每个项目最多 10 张参考图
- 单张图片不能超过 10MB
- 上传后会在浏览器内尝试压缩与缩放
- 最大边长限制为 `1600`
- JPEG 压缩质量为 `0.82`

重点函数：

- `fileToImage()`
- `canvasToDataUrl()`
- `dataUrlBytes()`
- `addFiles()`
- `deleteImage()`

需要注意：

- 图片以数据地址形式保存到 `localStorage`
- 图片过多或过大时，浏览器本地存储空间可能不足
- 现有代码已经包含对应提示，不要随意删除这些提示逻辑

## 新代理建议优先阅读的函数

进入项目后，建议先看 `src/App.jsx` 中这些函数：

- `createProject()`
- `loadProjects()`
- `loadSettings()`
- `fallbackGenerate()`
- `addFiles()`
- `checkHealth()`
- `callModel()`
- `sendMessage()`
- `updateMentionState()`
- `insertMention()`

如果只想最快理解主链路，优先看 `sendMessage()` 和 `callModel()`。

## 当前架构特征

- 当前是单文件主组件架构
- `src/App.jsx` 同时承担了：
- 常量定义
- 数据结构初始化
- 本地存储读写
- 接口调用
- 交互逻辑
- 大量界面渲染
- 当前没有路由系统
- 当前没有测试体系
- 当前没有 TypeScript
- 当前没有正式后端代码

## 协作建议

### 修改时的基本原则

- 除非任务明确要求重构，否则优先顺着现有结构修改
- 不要轻易拆散主流程，先确保功能正确
- 不要破坏 `localStorage` 兼容性
- 不要删除无密钥时的本地模拟生成功能
- 不要破坏 `split` 模板的严格格式要求
- 看到未使用字段时，先判断它是不是预留能力，不要立刻当成错误代码处理

### 适合后续拆分的区域

- Provider 配置与接口调用逻辑
- 提示词模板与规则逻辑
- 项目持久化逻辑
- 图片处理逻辑
- 大体量界面组件

### 如果要继续开发其它功能页

现有页面已经形成了稳定的工作台结构：

- 左侧：项目列表
- 中间：输入、对话、生成流程
- 右侧：结果与历史记录

后续新增真实功能页时，优先复用这套结构，而不是重做完全不同的布局体系。

## 当前工作区注意事项

当前仓库不是干净工作区。

已观察到的临时文件和运行痕迹包括：

- `vercel-deploy.log`
- `vercel-deploy2.log`
- `tunnel.log`
- `tunnel2.log`
- `server.out.log`
- `server.err.log`
- `bgtest.log`
- `temp-static-server.mjs`
- `.npm-cache/`
- `.npm-cache-a9365769-2a28-4c50-8e6d-22acf8eab49d/`

另外：

- `.gitignore` 当前已有本地修改
- 未经明确要求，不要擅自回退无关改动
- 清理文件前先判断这些内容是不是用户调试、部署或隧道测试留下的

## 新代理上手前十分钟建议

1. 先看 `package.json`
2. 再看 `src/App.jsx`
3. 再看 `src/style.css`
4. 启动 `npm run dev`
5. 手动验证以下流程：
- 新建和切换项目
- 上传图片
- 无密钥时是否能走本地模拟生成
- 设置面板是否能保存配置
- 历史记录是否能恢复到右侧结果区

## 可以默认成立的判断

- 这是一个前端优先、浏览器本地运行优先的项目
- 真正复杂的地方主要在提示词规则、交互流程和输出格式约束
- 大多数需求最终都会改到 `src/App.jsx`
- 样式调整通常会同时涉及 `src/style.css`

## 一句话介绍本项目

这是一个基于 Vite 与 React 的 AI 视频运镜提示词工作台，支持多项目管理、参考图上传、对话式需求整理、中英文提示词生成和历史记录回看；当前实现以前端为主，状态保存在浏览器本地，并支持多种兼容 OpenAI 的模型接口以及无密钥时的本地模拟生成。
