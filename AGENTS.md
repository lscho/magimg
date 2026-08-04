# AGENTS.md

本文件约束在 `client/` 范围内工作的 AI 编码代理。目标是保持幻画 AI 的业务契约、桌面能力、设计系统和工程质量一致。

## 1. 项目定位

幻画 AI 是基于 Tauri 2、Vue 3 和 TypeScript 的桌面 AI 图像生成工作台。当前功能包括：

- `gpt-image-2` 文生图与图生图参数配置。
- 本地 PNG、JPEG、WebP 图片编辑与临时预览。
- 基于量化 SAM 2.1 Hiera Base+、ViTMatte、Big-LaMa 与 Tauri/Rust 原生 ONNX Runtime 的 AI 抠图，支持嵌套框分层、消除修复和透明 PNG 导出。
- 混合式自动分层：本地 SAM/ViTMatte、PP-OCRv5 与 SigLIP2 负责元素、文字、命名、父子关系和修复蒙版；整页背景与多层父素材裁片打包成一张图集，只调用一次服务端生成式背景修复。
- 基于 Rust 原生编码器的 PNG、JPEG、WebP 桌面本地图片压缩，支持多文件、递归文件夹和目录结构保持。
- 提示词模板广场和生成页内模板选择。
- 登录、注册、积分余额、积分日志和充值套餐。
- 本地历史、设置持久化、输出目录选择和自动保存。
- Tauri 签名更新检查、普通/强制更新提示、安装后自动重启。
- 浏览器预览与 Tauri 桌面运行两种环境，均连接正式 API。

界面语言为简体中文。除协议字段、代码标识和必要英文标签外，新增用户文案应使用简洁中文。

## 2. 技术栈与入口

- Vue 3.5，Composition API，`<script setup lang="ts">`。
- Pinia：全局业务状态位于 `src/stores/app.ts`。
- Vue Router：Hash 路由位于 `src/router.ts`。
- Vite：开发端口 1420，配置位于 `vite.config.ts`。
- Tauri 2：桌面配置和权限位于 `src-tauri/`。
- 图标：仅使用 `lucide-vue-next`。
- 样式：`src/styles/main.css` 提供布局，`src/styles/liquid-glass.css` 提供主题。

关键目录：

```text
src/
  components/       可复用功能组件和弹窗
  constants/        默认生成参数
  services/         API、Tauri 桥接、本地存储
  stores/           Pinia 全局状态
  styles/           全局布局与设计主题
  views/            路由级编排组件
docs/               后端契约与设计规范
src-tauri/           Rust 入口、桌面配置和 capability
```

## 3. 当前事实与已知缺口

代理必须基于以下现状工作，不得把占位能力描述为已完成：

- 客户端仅请求正式 API，不提供本地 Mock 模式。
- 真实客户端接口以 `docs/CLIENT_API.md` 为准，旧 `docs/backend-api.md` 契约已废弃。
- 设置中的 `apiBaseUrl` 保存后会动态改变 `apiClient.ts` 的请求地址。
- 真实图生图会先上传参考图，再用 `inputAssetId` 创建任务。
- 自动分层路由 `/auto-layer` 位于第一组 AI 抠图之后。原图默认占满工作区，云修复成功前不显示结果预览；完成后结果抽屉自动展开，桌面默认 50/50 且分隔线可在 25%–75% 拖动，900px 以下结果全宽。元素框复用一次 SAM 编码，使用最多 32px 的有界上下文提示并经 ViTMatte 精修；默认使用最高分候选，只有另一可靠候选轮廓近似相同且能显著补全内部透明洞时才保守回退。文字框跳过 SAM，由本地 PP-OCRv5 按行识别并用整框单行结果复核碎片检测。自动关系允许少量选框贴边误差；每个父级只清除直接子层，元素使用高召回 Alpha，文字使用实际字形 Alpha 做 2–4px 有界扩张。整页背景与所有父素材上下文裁片打包为一张由暗色留白分隔的修复图集，通过独立 `/auto-layer-tasks` 任务只调用一次云端图片编辑，返回后分别回填整页背景和父素材。图集按像素上限布局，再按实际编码字节上限尝试 PNG/WebP 和等比缩小。OCR/命名资源没有独立下载按钮，首次点击“一键分层”确认下载并在主按钮显示进度；计费使用 `POST /matting mode=autoLayer` 和服务端 `autoLayerCost`（默认 20）。云任务失败或取消由服务端退款并保留不可预览草稿。分层文档只在页面会话中存活；桌面端选区记录最多 50 条，浏览器不能保存或恢复选区、运行模型、模拟推理或导出项目目录。
- 自动分层质量补充：精修 Alpha 确实越过紧选框边缘时，素材导出范围才向对应方向小幅扩展；普通中文 UI 与描边小字自动回退为字重 400，极强粗体证据才使用 600，自动识别不输出 700。云端上游输入必须清空图集联合蒙版内的 Alpha 与隐藏 RGB，服务端只允许在各分区的原蒙版内合成一次；客户端拆分结果时直接采用服务端 RGB 并保留素材 Alpha，不得再次按软蒙版混合。
- 浏览器预览使用 `localStorage` 保存设置、历史和登录会话；Tauri 使用 plugin-store。
- 自动更新仅在正式构建启用，使用独立签名端点，不跟随设置中的 `apiBaseUrl`；浏览器预览不检查更新。
- 结果区已接入复制、跳转图片编辑、AI 抠图、桌面“另存为”和打开默认保存位置；文生图与图生图结果均支持右键菜单和右上角悬浮 AI 抠图入口。编辑按钮将当前结果一次性交接到独立 `/editor` 页面，不使用弹窗。主导航上方分为两组：模板广场和历史记录位于第一组 AI 抠图之后，`/editor` 位于第二组并紧跟桌面专属的 `/compress` 之后。图片编辑页无独立页头、外边距或底部状态栏，采用“主内容区 + 右侧栏”布局；主内容区包含 44px 单列工具栏和透明棋盘画布，支持缩放与拖动，右侧栏只包含尺寸、工具属性与应用操作。无图片时整块棋盘投放面支持点击或拖放本地文件；应用后图片右键菜单提供复制和另存为。当前模式存在成功结果时生成主按钮显示“重新生成”。编辑页状态只在该页面存活，不回写结果预览、服务端任务或创作历史。
- 图片压缩路由 `/compress` 是桌面主导航第二组首项，`/editor` 紧随其后；压缩状态只在 `useImageCompression` 与 Rust 页面会话中存活，不进入 Pinia、历史或服务端。多文件与递归文件夹导入只接受静态 PNG/JPEG/WebP；PNG 使用 oxipng 无损优化，JPEG 使用 mozjpeg，WebP 使用静态 libwebp，三者保持原格式、应用方向、保留色彩信息并移除隐私元数据。待处理列表由 Rust 会话按需生成缩略图，接近可视区时加载并支持悬停或键盘聚焦放大预览，绝对源路径不暴露给前端。右侧栏显示输出目录与逐项结果，编码参数集中在设置弹窗；默认同名策略为自动重命名，单文件输出目录可与源文件目录相同但原文件不可覆盖。文件夹输出用输出根替换源根并保留相对目录。浏览器隐藏入口，直接访问仅显示不可用边界，不实现 Canvas/WASM 降级。
- 项目使用 Vitest 覆盖 AI 抠图选区树、修复蒙版、自动分层图层变换、图集字节预算、候选回退、OCR 后处理、选区记录清理、历史迁移和 API 客户端契约；`npm run test:repair` 使用 `tests/background-repair.case.json` 对 `tests/test.png` 执行无需启动应用的 UI 背景修复回归，并把图像与诊断结果写入 `tests/output/background-repair/`。`npm run test:auto-layer` 会读取桌面端保存的选区记录，经真实 Tauri IPC 运行生产本地模型并把全部素材、候选/精修/父层/整页蒙版、图集和元数据写入 `tests/output/auto-layer/`；默认不扣积分，只有显式 `-- --cloud` 才创建一次正式云任务并消耗 20 积分。目前没有 E2E 测试脚本。
- `GeneratorPanel` 固定模型为 `gpt-image-2`、数量为 1、背景为 `auto`。
- 任务接口使用 camelCase 的 `outputFormat`，并仅为 JPEG/WebP 接收 `output_compression`；背景、审核、流式、风格和图生图强度等旧参数仍不接收，差异见 `docs/client-api-integration-gaps.md`。
- AI 抠图推理为纯客户端本地能力，使用 Rust `ort 2.0.0-rc.10` 与原生 ONNX Runtime 1.22 运行量化 SAM 2.1 Hiera Base+ 和全精度 `Xenova/vitmatte-base-composition-1k`，不再使用 `onnxruntime-web`/WASM；但计费走正式 API：本地抠图开始前调用 `POST /matting`（带 `Idempotency-Key`）预扣 `mattingCost` 积分拿到 `mattingId`，抠图失败或取消时用 `mattingId` 调 `POST /matting/:id/refund` 全额退回，成功则扣费生效。`mattingCost` 由 `GET /capabilities` 下发（默认 5，取值 1–1,000,000 正整数），服务端权威读取不可篡改。未登录时点击抠图弹出 `LoginModal context="matting"`，登录成功后自动重试；积分不足（余额 < `mattingCost` 或预扣返回 409）时禁用按钮并提示充值。右侧不展示模型列表或开关；仅在 SAM 2.1 与 ViTMatte 任一缺失时显示统一资源包下载提示，两部分均就绪后提示隐藏。一次安装会跳过已就绪部分，并以连续总进度补齐其余资源。SAM 2.1 ONNX 固定到 `onnx-community/sam2.1-hiera-base-plus-ONNX` 提交 `bab18593f44e652f04cf18b60b3690f60e8996b0`，逐文件流式写入 encoder、decoder 与两份 external-data 权重，并按大小和 SHA-256 校验，安装状态写入 `model-manifest.json`；ViTMatte Base 固定到提交 `1290b014b994e95ca1b9dd9c5f72c3b6d5b7236a`（387371620 字节），由 `cutoutRefinerManager.ts` 按 SHA-256 校验并通过 v2 `cutout-refiner-manifest.json` 管理，安装成功后清理旧 Small 文件。模型统一保存到 `appDataDir/models/`，不随安装包分发；Windows NSIS 会把目标架构的 MSVC v143 app-local CRT DLL 放到主程序同目录，以满足官方 ONNX Runtime 的原生依赖。Rust 只从该目录的白名单加载文件并在会话创建前再次校验；前端按 ImageNet 均值方差生成 1024x1024 NCHW 输入并通过 Raw IPC 发送，Rust 持有 decoder、三层 embedding 与优化模型会话，encoder 完成后释放。需要模型时同一任务只编码图片一次，多选区复用 embedding；取消会终止当前 ONNX Runtime 运行。矩形框固定链路为 SAM -> 三值 trimap -> ViTMatte：一般选区由 decoder 按 `iou_scores` 选择 `pred_masks` 候选并输出软 alpha；只有一个独立提取框时，近似同分候选会优先选择确定前景明显更完整的主体，减少人像内部孔洞。选区包含少量上下文，确定前景与外部连通背景强制回填，封闭的主体内部缺口保持未知以避免主体被抠穿，再将 alpha 双线性恢复并与原图 alpha 相乘。浏览器预览不能下载与加载模型。官方最新 SAM 3.1 需要 PyTorch/CUDA、授权权重且暂无适配当前链路的官方 ONNX，不能描述为客户端已支持。旧 ViT-H/ViT-L/ViT-B/MobileSAM 文件不会自动删除，但不再展示、下载或加载。框选坐标统一存图像坐标系，结果按选区 bbox 裁剪导出透明 PNG。路由 `/cutout` 在主导航中位于图生图下方，也可从文生图/图生图结果区与图片编辑页右键菜单进入。
- 完整成功的 AI 抠图任务会把原图、选区和全部透明结果保存到 `appDataDir/cutout-history/`，清单由 plugin-store 管理并最多保留最近 100 条。历史页“AI 抠图”tab 支持多选下载/删除，右键可恢复原图、选区和结果；恢复后修改选区会清空旧结果，再次抠图重新扣费并新增记录。该能力严格限定在 Tauri 桌面端，浏览器端不得增加 IndexedDB、localStorage、Mock 历史或其他兼容实现。
- AI 抠图的矩形框与多边形点选均沿用 SAM -> ViTMatte 透明素材链路；多边形按原图坐标持久化顶点，以外接框提示模型提取内部元素，并在可靠候选中优先选择外轮廓接近但内部更完整的遮罩，精修后再限制最终 Alpha。该入口只在 `/cutout` 显示，自动分层继续使用元素框和文字框。95% 几何包含且面积比低于 80% 的嵌套选区按外接框自动建立最近父子关系，叶子输出前景、有子级的父选区输出修复背景。背景移除合并子级 ViTMatte Alpha 与附近 SAM 弱响应，并按子元素长边 2.5% 动态扩张（4–18 px），减少阴影、描边和碎片残留。选区上不显示编号或用途文字，删除按钮仅在悬停或键盘聚焦时出现；框选或点选工具下拖动边界可移动选区，松手重算关系并记录一条撤销历史。消除修复工具支持 SAM 点提示智能吸附以及手动添加/恢复。本地修复自动按素材上下文分流：纯色或缓渐变 UI 使用确定性二维调和扩散；没有直接子框且所有添加笔画都关闭智能吸附时强制使用扩散，与 `npm run test:repair` 一致；嵌套子框、智能吸附或复杂纹理可使用 `Carve/LaMa-ONNX` 提交 `c3c0c9e468934d62e79c329e35d82dd09ff8c444` 的 512×512 FP32 模型。模型单独按需下载并由 `cutout-repair-manifest.json` 管理。本地流程以上一步得到的父级精修 Alpha 收紧素材内容边界，Alpha 外像素和模型方形留白使用素材主背景色，选区余量中的底图不会进入修复上下文，进入修复前释放 SAM 与 ViTMatte 会话。云端档仅在能力字段明确启用时显示，首次上传原图、背景选区外接框和联合蒙版，服务端按每个外接框裁剪上下文后分别修复；同一原图微调时复用服务端素材 ID 并只上传新蒙版与选区外接框，该 ID 随本地抠图历史恢复。两档均只合成修复蒙版内 RGB，浏览器预览不能运行或模拟修复。
- 多边形点选的封闭内部 Alpha 缺口可在至少一个受多边形约束的 SAM 候选提供更高支持时恢复；与外部连通的缺口必须同时由至少两个候选强一致支持，且只恢复候选内部像素，不得改变候选边缘。不得填满整块多边形，也不得恢复所有候选一致判空的真实孔洞。
- 抠图历史 schema v2 保存父子关系、选区用途、矢量笔画和结果类型；旧记录缺省迁移为独立前景。只有全部背景修复成功的任务写入完整历史，云端失败保留页面中已完成的前景且不写历史。

若任务涉及上述缺口，应明确区分“补实现”和“调整现有实现”，并同步相关文档。

## 4. 修改前规则

1. 先阅读 `README.md`、相关组件、store、service 和对应文档，不根据文件名猜测行为。
2. 运行 `git status --short`，保留用户已有改动；不得回滚、覆盖或格式化无关文件。
3. 控制修改范围。视觉任务不得顺带改 API，接口任务不得无理由重构整个 UI。
4. 新依赖必须有明确收益，优先使用 Vue、浏览器、Tauri 和现有依赖已提供的能力。
5. 不提交密钥、Token、真实支付信息、用户目录或本机绝对路径。

## 5. Vue 代码规范

- 一律使用 Composition API 和 `<script setup lang="ts">`，除非现有文件明确需要其他形式。
- SFC 顺序为 `<script>`、`<template>`、`<style>`。
- 路由 view 保持编排职责；复杂表单、列表和操作区放在聚焦的子组件中。
- Props 向下、事件向上；Props 和 emits 必须使用 TypeScript 类型声明。
- 源状态保持最小，派生值使用 `computed`，副作用使用 `watch` 或生命周期函数。
- 不在 computed 中发请求、写存储、emit 或修改状态。
- 不直接解构 `reactive` 对象导致响应性丢失。
- 组件需要双向绑定时优先使用 Vue 3.4+ 的 `defineModel`；兼容现有契约时可保留显式 `update:*` 事件。
- 列表必须使用稳定的原始值 `key`，不得把 `v-if` 和 `v-for` 放在同一元素上。
- 禁止将用户内容直接传给 `v-html`。
- 只在逻辑复用、状态复杂或副作用明显时新增 composable；纯格式化函数放普通工具模块。
- Pinia store 负责跨页面业务状态和持久化编排，展示状态优先留在组件内。

## 6. API 与数据契约

- `src/types.ts` 是客户端领域类型的源文件。
- `src/services/apiClient.ts` 是真实接口路径和序列化的源文件。
- `docs/backend-api.md` 是后端联调契约；修改 endpoint、字段、枚举或鉴权方式时必须同步更新。
- 业务请求与响应默认使用 camelCase；任务压缩率字段 `output_compression` 保留 snake_case，转换边界位于 `toCreateTaskBody()`。
- 金额使用整数分，积分使用整数，不引入浮点金额。
- 受保护请求统一通过 `setAccessToken()` 管理 Authorization，不在组件里直接拼接 Token。
- 不在组件中直接调用 `fetch`；请求放入 service，业务编排放入 store。
- 真实图生图上线前必须先实现上传接口，不得把桌面本地路径当成服务端可访问 URL。

## 7. Tauri 与浏览器边界

- 所有桌面能力集中在 `src/services/desktop.ts` 或同层 service，不在 Vue 组件中直接访问 `window.__TAURI__`。
- 新 Tauri 插件需要同时更新前端依赖、Rust 依赖、capability 和必要文档。
- 每个桌面操作必须有明确的浏览器预览降级行为。
- 文件写入、打开外链和目录选择必须验证空值；不得扩展为任意路径访问。
- 持久化结构变化要提供向后兼容的默认值合并，不能假设旧 JSON 包含新字段。
- 保持 `src-tauri/tauri.conf.json` 中最小窗口 1080x720 下可用。
- AI 抠图的推理、工作恢复、历史清单与图片二进制持久化均为 Tauri 桌面专属能力；浏览器预览只保留现有不可运行模型的界面边界，不实现或模拟抠图历史。

## 8. 视觉与交互规范

实现 UI 前先阅读 `docs/design-system.md`。

- 以客户端软件状态和交互为核心
- 复用 `src/styles/liquid-glass.css` 中的 tokens，不在组件中复制主题色。
- 液态玻璃只用于侧栏、主工具面板和弹窗等有层级意义的表面。
- 页面区段保持无框；禁止装饰性卡片嵌套和到处使用悬浮卡片。
- 卡片圆角不超过 8px，控件通常为 6-7px。
- 不使用渐变球、光斑气泡、Emoji 图标或手绘已有 Lucide 图标。
- 不使用 Inter、Roboto、Arial 或在线字体作为新增视觉依赖。
- 字距统一为 0；字号不随视口宽度缩放。
- 主图必须展示真实内容，不能用纯氛围图替代可检查的生成结果或模板效果。
- 熟悉的工具操作优先使用图标按钮，并提供 `title` 或 `aria-label`。
- hover 不得引起布局位移；必须实现 focus-visible、disabled、loading 和 reduced-motion 状态。
- 玻璃表面不能以牺牲对比度为代价。正文至少使用 `--muted`，边界至少使用 `--line`。
- 新增固定格式元素时使用明确尺寸、网格轨道或 `aspect-ratio`，避免内容变化导致布局抖动。
- 同时验证桌面和移动断点，文本不得溢出、遮挡或与相邻控件重叠。

## 9. 文案与无障碍

- 用户文案描述任务和结果，不在界面中解释视觉风格、功能清单或键盘教程。
- 按钮使用明确动词；破坏性操作要有危险语义和必要确认。
- 表单必须有可访问名称；只有 placeholder 不算标签。
- 图标按钮必须有 `aria-label`，对话框必须有 `role="dialog"`、`aria-modal` 和标题关联。
- 新模态框必须支持 Escape 关闭和基础焦点管理。
- 图片提供符合用途的 alt；纯装饰元素不进入读屏顺序。
- 不只依赖颜色表达成功、失败、选中或消费状态。

## 10. 验证要求

每次代码变更至少运行与风险相称的检查：

```bash
npm run typecheck
npm run build
```

视觉改动还必须检查：
- 本项目只发布客户端，只检查客户端常见分辨率即可，比如1520x920：Tauri 默认窗口
- 控制台 error

涉及 Rust 或 Tauri 配置时，若本机有 Rust 工具链，再运行：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

若因为环境限制未运行某项检查，交付时必须明确说明。

测试账号：18888888888
测试密码：12345678

## 11. 文档同步

- 功能、启动方式、环境变量或插件变化：更新 `README.md`。
- API 字段、路径、状态或优先级变化：更新 `docs/backend-api.md`。
- tokens、组件外观、断点或视觉规则变化：更新 `docs/design-system.md`。
- 工程结构、AI 工作规则或已知缺口变化：更新本文件。

## 12. 完成定义

任务只有在以下条件同时满足时才算完成：

1. 请求的行为或视觉已经实现，不是只给方案。
2. 正式 API 请求、浏览器代理与 Tauri 原生 HTTP 边界未被破坏。
3. TypeScript 类型、接口文档和 UI 文案一致。
4. 桌面与移动布局无明显回归，键盘焦点可见。
5. 必要命令通过，或已准确报告无法执行的原因。
6. 没有夹带无关重构、生成文件或依赖升级。
