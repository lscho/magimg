# 幻画 AI

基于 Tauri 2、Vue 3、TypeScript 的桌面端 AI 图片生成工作台，包含 `gpt-image-2` 文生图与图生图、提示词模板广场、登录注册、积分充值与日志、支持模式筛选和分页的创作历史，以及保存目录设置。

## 启动

```bash
npm install
npm run dev
```

浏览器预览地址默认是 `http://127.0.0.1:1420/`。

桌面模式需要先安装 Rust 工具链：

```bash
npm run tauri dev
```

macOS 桌面窗口使用原生标题栏 Overlay，系统关闭、最小化和缩放按钮与应用标题位于同一顶部栏；浏览器预览不会模拟系统窗口按钮。

当前项目使用 Tauri 插件：

- `@tauri-apps/plugin-dialog`：选择保存目录和图生图参考图。
- `@tauri-apps/plugin-fs`：保存生成图片到本地。
- `@tauri-apps/plugin-opener`：打开输出目录和外部充值支付链接。
- `@tauri-apps/plugin-store`：以 JSON 形式保存设置、历史和登录缓存。

## 项目文档

- [石墨工作台设计规范](docs/design-system.md)：颜色、材质、排版、组件、响应式与验收标准。
- [客户端 API 契约](docs/CLIENT_API.md)：真实服务端端点、字段、错误码与任务生命周期。
- [API 接入状态与差异](docs/client-api-integration-gaps.md)：已接入功能、跳过项和待确认事项。
- [AI 开发约束](AGENTS.md)：项目现状、工程边界、编码规范与完成定义。

## 接口模式

复制 `.env.example` 为 `.env` 后可配置：

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_USE_MOCK_API=true
```

`VITE_USE_MOCK_API=true` 时，短信认证、模板、积分、图片上传和生成任务都使用本地 Mock，方便完整演示。切到真实后端时设置为 `false`。客户端会在 `VITE_API_BASE_URL` 后自动添加 `/api/client/v1`；该变量也可以直接填写包含基础路径的地址。

真实模式支持手机号登录、短信注册与重置密码、卡密兑换、服务端模板、图生图上传、异步任务轮询和排队任务取消。应用设置中也可修改 API 服务地址；切换地址会清除旧服务的登录会话。

浏览器预览使用 `localStorage` 保存登录会话、设置和历史，刷新页面后会恢复登录状态；退出登录或服务端返回 401 时会清除本地会话。

开发服务器会把 `/api/client/v1`、`/images` 和 `/uploads` 代理到 `VITE_API_BASE_URL`，避免浏览器预览受跨域限制。生产 Tauri 应用直接请求该地址，后端必须允许应用 WebView 的跨域请求。

## 验证命令

```bash
npm run typecheck
npm run build
```
