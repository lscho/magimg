# 幻画 AI

基于 Tauri 2、Vue 3、TypeScript 的桌面端 AI 图片生成工作台，包含 `gpt-image-2` 文生图与图生图、本地图片编辑、AI 抠图（本地模型）、提示词模板广场、登录注册、卡密购买与积分兑换、积分日志、支持文生图、图生图与 AI 抠图筛选和分页的创作历史，以及保存目录设置。

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

客户端只连接正式 API，不提供本地 Mock 数据。短信认证、模板、积分、图片上传和生成任务都会请求 `VITE_API_BASE_URL` 配置的服务；客户端会自动添加 `/api/client/v1`，该变量也可以直接填写包含基础路径的地址。模板广场和模板选择弹窗使用跟随图片比例的三列瀑布流，较窄窗口自动降为两列或单列；创作历史继续使用 264×264px 固定卡片的规则网格。图生图模板支持拖动分割线对比原图和生成结果，模板信息与操作在悬停或键盘聚焦时显示。

客户端支持手机号登录、短信注册与重置密码、卡密兑换、服务端模板、图生图上传、输出格式与 JPEG/WebP 压缩率、异步任务轮询和排队任务取消。

浏览器预览使用 `localStorage` 保存登录会话、设置和生成历史，Tauri 桌面端使用 plugin-store 保存同类数据。AI 抠图历史是桌面专属能力，不使用浏览器 `localStorage`、IndexedDB 或 Mock 降级。登录或注册成功后会持久化 Bearer token；下次启动会在界面挂载前恢复未过期 token 并直接注入 API 请求。退出登录、缓存已过期或服务端返回 401 时会清除本地会话。

文生图与图生图菜单每次切换都会新建空白工作区，并恢复用户设置的默认参数；提示词只有在用户设置默认提示词或主动套用模板时才会自动填入。生成期间切换菜单不会中断任务，预览区右上角会显示最近一个进行中任务，点击后可恢复查看；重新打开客户端时也会从服务端找回该任务并继续查询状态。未登录点击生成会直接打开登录窗口，登录成功后仍需由用户再次确认生成。

结果区提供复制、编辑、下载和打开默认保存位置操作。结果出现后的空闲时段会预热 Fabric 和当前原图；点击编辑后读取当前结果并直接跳转到图片编辑页，不再打开弹窗。编辑器支持裁剪、90° 旋转、水平翻转、亮度/对比度/饱和度/灰度调整，以及文字、画笔和仅清除标注的橡皮擦。画布可在适应视图的 25%–400% 范围内缩放，支持滚轮按指针位置缩放，并可使用拖动工具平移底图与全部标注。裁剪面板实时显示原图像素坐标下的选区宽高，也可输入整数尺寸；手动输入会切换到自由比例，选区贴边时边框和控制点保持在图片内。裁剪框允许少量边缘拖动容差并在松手后精确吸附，文字对象支持通过右键菜单删除。编辑结果只在图片编辑页生效，不回写生成任务、结果预览或创作历史。

图片编辑页不在左侧主导航展示，仅可从文生图或图生图的结果区域进入。进入页面后不显示独立页头、外边距或底部状态栏，而是直接显示与生成页一致的两栏工作台：主内容区包含 44px 单列图片工具栏和透明棋盘画布，右侧栏只显示图片尺寸、当前工具属性和“应用编辑”按钮。未载入图片时工具保持禁用，主内容区显示带边框的透明棋盘投放面和“拖放图片”文字；点击投放面仍可选择本地 PNG、JPEG、WebP，桌面 WebView 也支持标准文件拖放。应用后编辑器保持在页面内，可继续修改；图片右键菜单提供“复制”和“另存为”，两项操作均使用最近一次已应用的结果，JPEG/WebP 默认按 0.92 质量导出。该页面的原图、编辑文档和导出 Blob 只在当前页面存活，离开页面后释放，不写入 Pinia、创作历史或服务端。另存为在桌面端会打开系统文件对话框，浏览器预览使用浏览器下载；文生图结果图片仍支持右键复制、下载，或作为参考图直接进入图生图页面。设置了默认保存目录后，结果区会显示打开文件夹按钮。创作历史支持点击任务多选；任务卡右键可打开任务，或对首张结果图执行复制、保存和图生图，四项操作使用同一菜单层级。打开任务会恢复提示词、生成参数、图生图参考图和结果图片；图生图动作则把结果图作为新工作区的参考图。失败或无图片任务可批量删除，仅当所选任务均有结果图片时才显示批量下载。桌面端通过原生 HTTP 客户端读取远程图片并批量保存到所选目录，浏览器预览则使用浏览器的多文件下载。

AI 抠图页（`/cutout`）在左侧主导航中位于“图生图”下方，也可从文生图/图生图结果区工具栏或图片编辑页右键菜单进入，沿用与生成页一致的两栏布局。页面始终显示透明棋盘工作台；无图片时不切换提示页，可通过左侧导入按钮或直接拖入 PNG、JPEG、WebP。框选使用原生 Pointer Capture，绘制时实时跟随指针；多个选区并存，选框上不显示编号或用途文字，删除按钮仅在鼠标悬停或键盘聚焦选框时出现，并支持单独删除、撤销与重做。框选工具下可拖动选框四条边移动选区，松手后重新计算嵌套关系并把整次移动写入一条撤销记录；框内空白仍用于继续绘制嵌套小框。独立框保持原有透明素材提取；小框至少 95% 位于大框且面积小于其 80% 时自动建立最近父子关系，小框提取前景，大框合并直接子级遮罩并修复背景，用户可把选区切回独立提取。消除修复工具支持 SAM 智能吸附、手动添加/恢复和图像坐标系笔刷，全部操作进入同一撤销历史；没有选框时不显示笔刷光标，多选框下悬停会提示可切换目标，首次点击只激活目标，只有当前背景选区内才允许开始涂抹。

背景选区出现后，右侧显示本地/云端修复档位。本地档首次使用时单独按需下载 Big-LaMa，不增加普通抠图资源包体积；云端档只在 `GET /capabilities` 明确下发 `backgroundRepairEnabled: true` 时显示，首次提交原图、所有背景选区坐标和联合灰度蒙版，同一原图后续微调复用服务端素材 ID、只上传新蒙版与选框坐标。服务端按背景选区分别裁剪后修复，模型不会读取框外大图内容。两档都只合成修复蒙版内的 RGB，框外与未遮挡像素保持原值，父级精修 Alpha 仍决定最终透明边界。云端失败或取消由服务端幂等退款，页面保留已经完成的前景素材。右侧结果以“素材/背景”标记区分类型。

桌面端会在完整抠图成功后把原图、选区关系、矢量笔画和全部透明 PNG 保存到 `appDataDir/cutout-history/`，任务清单由 plugin-store 管理，最多保留最近 100 条。历史 schema v2 会把旧矩形记录兼容迁移为独立前景选区。创作历史中的“AI 抠图”页签支持多选下载和删除；任务卡右键只提供恢复工作和保存全部素材。恢复工作后调整选区、关系或笔画会清空旧结果，再次抠图会重新扣费并新增独立历史任务，不覆盖原记录。浏览器预览不读取、写入或模拟这些记录。

SAM 2.1 模型的 encoder、decoder 及两份 external-data 权重会逐文件流式写入本地，并按固定大小和 SHA-256 校验；不再下载或解压旧 SAM ZIP。推理使用 Tauri/Rust 原生 `ort 2.0.0-rc.10` 与 ONNX Runtime 1.22，不加载 `onnxruntime-web` 或 WASM：前端将图片直接缩放到 1024x1024，按 ImageNet 均值方差生成 NCHW 输入，再通过 Raw IPC 发送；Rust 从 `appDataDir/models/` 白名单路径加载并再次校验四个文件，encoder 产生三层 image embedding 后立即释放大会话，decoder 与 embedding 留存供同一任务的多个框选和智能笔画复用。框选提示通过 `input_boxes` 传入，智能笔画最多采样 8 个前景点并复用 `input_points`；取消操作会终止当前原生运行。

Windows 的官方 ONNX Runtime 二进制依赖 Microsoft Visual C++ 运行库。桌面正式构建会从目标架构的 MSVC v143 工具链中提取 `Microsoft.VC143.CRT`，并将其中的 DLL 作为 app-local 资源放在主程序同目录；安装和自动更新均不要求用户另行安装 VC++ Redistributable。Windows 打包机必须安装对应架构的 MSVC v143 C++ Build Tools；脚本无法自动定位时，可将 `MSVC_CRT_DIR` 指向目标架构的 `Microsoft.VC143.CRT` 目录。

基础链路由 SAM 2.1 decoder 按 `iou_scores` 选择评分最高的 `pred_masks` 候选，并把阈值附近的浮点 logits 转为 8 位软 alpha。客户端随后固定以 SAM mask 生成三值 trimap，在带上下文的选区裁剪上运行 ViTMatte；确定前景与外部背景会在推理后强制回填，封闭的主体内部缺口保留为未知区域交给 ViTMatte 判断，避免主体中间被错误抠空。优化后的 alpha 双线性恢复到原图坐标后与原图 alpha 相乘，最终按用户选区边界输出透明 PNG。每个结果支持单个复制/保存；桌面批量导出只需选择一次目录。浏览器预览保留画布交互，但不能下载或运行本地模型。

截至 2026-07，Meta 官方最新版本是 [SAM 3.1](https://github.com/facebookresearch/sam3)，但其授权权重与运行环境没有适配本项目的原生 encoder/decoder ONNX 契约。当前资源包按桌面 CPU 推理兼容性固定使用以下量化模型：

| 档位 | 下载大小 | 内置下载地址 |
| --- | ---: | --- |
| SAM 2.1 Hiera Base+（quantized ONNX） | 103.6 MiB | [onnx-community/sam2.1-hiera-base-plus-ONNX](https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/tree/bab18593f44e652f04cf18b60b3690f60e8996b0/onnx) |

SAM 2.1 ONNX 资源使用 Apache-2.0 许可，下载地址固定到提交 `bab18593f44e652f04cf18b60b3690f60e8996b0`，总计 `108676041` 字节。客户端使用该提交中的 `vision_encoder_quantized.onnx`、`vision_encoder_quantized.onnx_data`、`prompt_encoder_mask_decoder.onnx` 和 `prompt_encoder_mask_decoder.onnx_data`，避免上游 `main` 内容变化导致模型与校验信息不一致。旧 ViT-H、ViT-L、ViT-B 和 MobileSAM 文件不会被主动删除，但客户端不再展示、下载或加载。

资源包同时包含 Apache-2.0 许可的 [Xenova/vitmatte-small-composition-1k](https://huggingface.co/Xenova/vitmatte-small-composition-1k)，下载 99.1 MiB 的全精度 ONNX 文件并固定到提交 `6bc1297f6140f055a227b6d2cfe8c093281f35d2`：[model.onnx](https://huggingface.co/Xenova/vitmatte-small-composition-1k/resolve/6bc1297f6140f055a227b6d2cfe8c093281f35d2/onnx/model.onnx)。客户端校验精确大小 `103885865` 字节和 SHA-256 `bf28d2e0be2c073286e88d60ad649d7123da2749a2d99133fd1098d5887e0225`。统一资源入口的总下载量为 `212561906` 字节（约 202.7 MiB），底层仍分别使用 `model-manifest.json` 与 `cutout-refiner-manifest.json` 持久化安装状态，因此能跳过已存在的部分并只补齐缺失资源；模型不随安装包分发。

本地背景修复使用自动混合策略：按钮、头像框等纯色或缓渐变 UI 先从当前素材 Alpha 内且修复蒙版外统计主背景色，再以二维调和扩散补全涂抹区域；没有直接子框、关闭智能吸附并使用“添加”产生的纯手动涂抹固定走该扩散路径，与命令行回归脚本一致，不再回退到 LaMa。双框背景的移除蒙版同时合并 ViTMatte 精修 Alpha 和其附近的 SAM 粗蒙版弱响应，并按子元素长边的 2.5% 动态扩张（限制 4–18 px），用于覆盖阴影、描边和发丝碎片；粗蒙版只在子框附近参与合并，不会扩散到父框边缘。嵌套子框、智能吸附或复杂纹理场景仍可调用 Apache-2.0 许可的 [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX/tree/c3c0c9e468934d62e79c329e35d82dd09ff8c444) `lama_fp32.onnx`。模型固定提交 `c3c0c9e468934d62e79c329e35d82dd09ff8c444`、大小 `208044816` 字节、SHA-256 `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`，输入固定为 512×512。客户端以父级精修 Alpha 收紧当前素材的真实内容边界，Alpha 外像素和模型方形留白统一使用素材主背景色，不再拉伸边缘形成条纹；矩形选框余量中的底图和框外图片内容不会进入修复上下文。模型输出再映射回素材边界，两条路径都只在羽化后的修复蒙版内合成。进入修复阶段前会释放已完成工作的 SAM 与 ViTMatte 会话，避免三个原生模型同时占用内存。模型使用独立 `cutout-repair-manifest.json`，由用户首次选择本地修复时下载。

本地 UI 背景修复可以脱离应用手动回归。默认用例读取 `tests/background-repair.case.json` 和 `tests/test.png`，复用生产环境的蒙版膨胀、材质分析、扩散与合成函数：

```bash
npm run test:repair
npm run test:repair -- tests/background-repair.case.json
```

用例中的 `selection` 使用原图坐标，`parentAlpha` 和 `removalMask` 使用相对选框的坐标，支持 `rect`、`roundedRect` 和 `ellipse`。结果写入被 Git 忽略的 `tests/output/background-repair/`，包含原始裁剪、灰度蒙版、蒙版叠加图、扩散结果和 `diagnostics.json`。诊断文件会记录主背景色、近似色覆盖率，以及生产逻辑当前会选择扩散还是 LaMa；当建议使用 LaMa 时，脚本仍输出扩散结果用于调试分类阈值，但不会在命令行加载 ONNX 模型。

开发服务器会把 `/api/client/v1`、`/images` 和 `/uploads` 代理到 `VITE_API_BASE_URL`，避免浏览器预览受跨域限制。生产 Tauri 应用通过原生 HTTP 插件请求该地址，不受 WebView CORS 限制；浏览器直接访问正式 API 时，后端仍需配置正常的 CORS 响应头。

正式桌面构建设置 `VITE_ENABLE_UPDATER=true` 后，客户端启动时会通过签名更新端点检查新版本。普通更新由用户确认，强制更新会阻断使用；更新包安装完成后客户端立即重启。浏览器预览和未启用 updater 的本地构建不会发起更新请求。发布脚本根据构建时的 `VITE_API_BASE_URL` 生成 `/api/client/v1/version/latest/tauri?platform={{target}}`，生成结果写入 Tauri 构建配置，不跟随设置中可修改的 `apiBaseUrl`。

## 验证命令

```bash
npm run test
npm run test:repair
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
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
