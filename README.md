# 幻画 AI

基于 Tauri 2、Vue 3、TypeScript 的桌面端 AI 图片生成工作台，包含 `gpt-image-2` 文生图与图生图、提示词模板广场、登录注册、卡密购买与积分兑换、积分日志、支持模式筛选和分页的创作历史，以及保存目录设置。

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

macOS 桌面窗口使用原生标题栏 Overlay，系统关闭、最小化和缩放按钮与应用标题位于同一顶部栏。Windows 桌面窗口隐藏原生标题栏和左上角产品图标、名称，在应用顶部栏右侧提供最小化、最大化/还原和关闭按钮；标题栏仍支持拖动、双击最大化和系统边缘吸附。所有桌面平台均禁用 WebView 原生右键菜单，浏览器预览不会模拟系统窗口按钮。

当前项目使用 Tauri 插件：

- `@tauri-apps/plugin-dialog`：选择保存目录、图生图参考图和生成结果的另存为位置。
- `@tauri-apps/plugin-fs`：保存生成图片到本地。
- `@tauri-apps/plugin-http`：在桌面端发送 API 请求和读取远程图片字节，绕过 WebView CORS 限制。
- `@tauri-apps/plugin-os`：识别 Windows/macOS 与 CPU 架构，映射客户端更新平台。
- `@tauri-apps/plugin-opener`：打开输出目录和外部充值支付链接。
- `@tauri-apps/plugin-process`：更新安装完成后重新启动客户端。
- `@tauri-apps/plugin-store`：以 JSON 形式保存设置、历史和登录缓存。
- `@tauri-apps/plugin-updater`：检查、校验、下载并安装签名更新包。

## 项目文档

- [石墨工作台设计规范](docs/design-system.md)：颜色、材质、排版、组件、响应式与验收标准。
- [客户端 API 契约](docs/CLIENT_API.md)：真实服务端端点、字段、错误码与任务生命周期。
- [API 接入状态与差异](docs/client-api-integration-gaps.md)：已接入功能、跳过项和待确认事项。
- [桌面客户端发布流程](docs/desktop-release.md)：签名构建、发布清单、后端登记和自动更新验收。
- [AI 开发约束](AGENTS.md)：项目现状、工程边界、编码规范与完成定义。

## 环境变量

本地开发和浏览器预览使用根目录 `.env`，可参考 `.env.example`：

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_ENABLE_UPDATER=false
```

正式客户端构建统一使用根目录 `.env.production`，可参考 `.env.production.example`：

```bash
VITE_API_BASE_URL=https://api.your-domain.com
VITE_ENABLE_UPDATER=true
```

`.env.production` 会随仓库进入 GitHub Actions。`npm run build` 以及 Tauri 正式构建中的前端步骤会由 Vite 自动加载该文件；构建会校验正式 API 必须使用 HTTPS。这里的变量会进入客户端构建，不能存放 updater 私钥、登录 Token 或其他服务端密钥。

客户端只连接正式 API，不提供本地 Mock 数据。短信认证、模板、积分、图片上传和生成任务都会请求 `VITE_API_BASE_URL` 配置的服务；客户端会自动添加 `/api/client/v1`，该变量也可以直接填写包含基础路径的地址。

客户端支持手机号登录、短信注册与重置密码、卡密兑换、服务端模板、图生图上传、输出格式与 JPEG/WebP 压缩率、异步任务轮询和排队任务取消。

浏览器预览使用 `localStorage` 保存登录会话、设置和历史，Tauri 桌面端使用 plugin-store 保存同类数据。登录或注册成功后会持久化 Bearer token；下次启动会在界面挂载前恢复未过期 token 并直接注入 API 请求。退出登录、缓存已过期或服务端返回 401 时会清除本地会话。

文生图与图生图菜单每次切换都会新建空白工作区，并恢复用户设置的默认参数；提示词只有在用户设置默认提示词或主动套用模板时才会自动填入。生成期间切换菜单不会中断任务，预览区右上角会显示最近一个进行中任务，点击后可恢复查看；重新打开客户端时也会从服务端找回该任务并继续查询状态。未登录点击生成会直接打开登录窗口，登录成功后仍需由用户再次确认生成。

结果区提供复制、编辑、下载和打开默认保存位置操作。编辑器在结果出现后的空闲时段预热 Fabric 和当前原图，并在同一任务内复用已读取数据；支持裁剪、旋转、翻转、亮度/对比度/饱和度/灰度调整，以及文字、画笔和仅清除标注的橡皮擦。裁剪框允许少量边缘拖动容差并在松手后精确吸附，文字对象支持通过右键菜单删除。应用后只替换当前工作区预览，复制、下载和图生图引用会使用编辑版本，切换任务或页面后恢复服务端原图，不写入创作历史。下载按钮在桌面端会打开系统“另存为”对话框，浏览器预览使用浏览器下载；文生图结果图片仍支持右键复制、下载，或作为参考图直接进入图生图页面。设置了默认保存目录后，结果区会显示打开文件夹按钮。创作历史支持点击任务多选；任务卡右键可打开任务，或对首张结果图执行复制、保存和图生图，四项操作使用同一菜单层级。打开任务会恢复提示词、生成参数、图生图参考图和结果图片；图生图动作则把结果图作为新工作区的参考图。失败或无图片任务可批量删除，仅当所选任务均有结果图片时才显示批量下载。桌面端通过原生 HTTP 客户端读取远程图片并批量保存到所选目录，浏览器预览则使用浏览器的多文件下载。

开发服务器会把 `/api/client/v1`、`/images` 和 `/uploads` 代理到 `VITE_API_BASE_URL`，避免浏览器预览受跨域限制。生产 Tauri 应用通过原生 HTTP 插件请求该地址，不受 WebView CORS 限制；浏览器直接访问正式 API 时，后端仍需配置正常的 CORS 响应头。

正式桌面构建设置 `VITE_ENABLE_UPDATER=true` 后，客户端启动时会通过签名更新端点检查新版本。普通更新由用户确认，强制更新会阻断使用；更新包安装完成后客户端立即重启。浏览器预览和未启用 updater 的本地构建不会发起更新请求。发布脚本根据构建时的 `VITE_API_BASE_URL` 生成 `/api/client/v1/version/latest/tauri?platform={{target}}`，生成结果写入 Tauri 构建配置，不跟随设置中可修改的 `apiBaseUrl`。

## 验证命令

```bash
npm run typecheck
npm run build
```

## 桌面端自动打包

GitHub Actions 工作流 `.github/workflows/build-desktop.yml` 会在推送 `v*` 版本标签时自动运行，也可以在 Actions 页面输入 SemVer 手动触发。标签中的版本号会写入 Tauri 应用版本。每次构建会分别上传以下 Artifact：

- `huanhua-windows-x64`：Windows x64 NSIS `.exe`，同一文件用于安装和 Tauri v2 updater，并附带 `.exe.sig`。
- `huanhua-windows-arm64`：Windows ARM64 NSIS `.exe`，同一文件用于安装和 Tauri v2 updater，并附带 `.exe.sig`。
- `huanhua-macos-x64`：macOS Intel 磁盘映像、带 `_x64` 后缀的 `.app.tar.gz` updater 包和 `.sig`。
- `huanhua-macos-arm64`：macOS Apple Silicon 磁盘映像、带 `_arm64` 后缀的 `.app.tar.gz` updater 包和 `.sig`。
- `huanhua-desktop-release-manifest`：供后端登记版本使用的 JSON 清单，包含四个平台的文件名、大小、SHA-256、updater 签名和标签发布来源 URL。

构建完成后，`prepare-release` 作业会校验四个平台的普通安装包、updater 包和签名是否齐全；任一产物缺失、签名为空或 GitHub Release 资产重名时发布失败。标签构建随后创建或更新 GitHub Release，再由 `sync-and-notify` 作业把不可变制品同步到腾讯云 COS/CDN、校验公开 HEAD 元数据，并通过 HMAC 接口在后台原子登记四个平台草稿。手动构建只生成保留 14 天的 Artifact，不上传 COS 或通知后台。完整配置和验收步骤见 [桌面客户端发布流程](docs/desktop-release.md)。

GitHub Actions 会直接读取仓库中的 `.env.production`，并用同一份 `VITE_API_BASE_URL` 生成客户端 API 和 updater 地址。修改正式接口配置后，需要先提交该文件再创建新版本标签。仓库还需要在 GitHub `Settings -> Secrets and variables -> Actions` 配置以下签名值：

- Repository variables：`TAURI_SIGNING_PUBLIC_KEY` 可配置为 Repository Variable，也可放入同名 Repository Secret，工作流会优先读取 Variable。macOS 正式分发还必须配置 `APPLE_SIGNING_IDENTITY`、`APPLE_API_ISSUER` 和 `APPLE_API_KEY`。`APPLE_SIGNING_IDENTITY` 是完整的 `Developer ID Application: 名称 (TEAM_ID)`，另外两项分别是 App Store Connect API 的 Issuer ID 和 Key ID。
- `production-release` Environment variables：`TENCENT_COS_BUCKET`、`TENCENT_COS_REGION`、`DESKTOP_RELEASE_CDN_BASE_URL`、`DESKTOP_RELEASE_API_URL`。
- Repository/Environment secrets：`TAURI_SIGNING_PRIVATE_KEY` 必须配置；`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 仅在私钥设置了密码时配置。macOS 签名和公证还必须配置 Base64 编码的 `APPLE_CERTIFICATE`、证书导出密码 `APPLE_CERTIFICATE_PASSWORD`，以及 Base64 编码的 App Store Connect `.p8` 私钥 `APPLE_API_KEY_P8`。COS/后台登记另需 `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY` 和至少 32 字符的 `DESKTOP_RELEASE_WEBHOOK_SECRET`。

发布时根据 `huanhua-desktop-release-manifest.json` 校验并登记产物：Windows 的 NSIS `.exe` 同时用于普通安装和 Tauri v2 updater，macOS 的 `.dmg` 用于普通安装、`.app.tar.gz` 用于 updater；四个平台 updater 均使用对应 `.sig` 内容验签。1 MiB 以上文件使用 1 MiB COS 分片、4 路并发和单片重试，确保所有安装包与 updater 避免长时间单连接上传。COS CAM 身份只应允许目标 bucket 的 `desktop/releases/*` 前缀执行 PutObject、GetObject、InitiateMultipartUpload、UploadPart、CompleteMultipartUpload 和 AbortMultipartUpload，不授予 DeleteObject 或全桶管理权限。updater 私钥、Apple `.p12`、App Store Connect `.p8`、COS SecretKey 和后台 Webhook Secret 只保存在 Actions Secrets 中，不能提交、记录或上传为构建产物。

macOS 构建会导入 Developer ID Application 证书，通过 App Store Connect API 完成公证并由 Tauri staple；Windows 当前仍未配置代码签名，直接分发时系统可能显示安全提示。

Windows 使用平台专属的英文产品名 `Huanhua AI`，NSIS 默认安装目录和安装包文件名不包含中文；应用窗口和界面仍显示“幻画 AI”。macOS 继续使用中文产品名。产品名变更后的首个 Windows 版本必须从已有中文目录安装版本执行一次升级与卸载验收，确认旧测试版本不会残留。
