# 幻画 AI

基于 Tauri 2、Vue 3、TypeScript 的桌面端 AI 图片生成工作台，包含 `gpt-image-2` 文生图与图生图、提示词模板广场、登录注册、积分充值与日志、本地历史和保存目录设置。

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

当前项目使用 Tauri 插件：

- `@tauri-apps/plugin-dialog`：选择保存目录和图生图参考图。
- `@tauri-apps/plugin-fs`：保存生成图片到本地。
- `@tauri-apps/plugin-opener`：打开输出目录和外部充值支付链接。
- `@tauri-apps/plugin-store`：以 JSON 形式保存设置、历史和登录缓存。

## 项目文档

- [液态玻璃设计规范](docs/design-system.md)：颜色、材质、排版、组件、响应式与验收标准。
- [后端接口契约](docs/backend-api.md)：客户端所需接口、字段、错误码与联调优先级。
- [AI 开发约束](AGENTS.md)：项目现状、工程边界、编码规范与完成定义。

## 接口模式

复制 `.env.example` 为 `.env` 后可配置：

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_USE_MOCK_API=true
```

`VITE_USE_MOCK_API=true` 时，登录、积分、生成和充值都使用本地 Mock，方便完整演示。切到真实后端时设置为 `false`，接口契约见 [docs/backend-api.md](docs/backend-api.md)。

## 验证命令

```bash
npm run typecheck
npm run build
```
