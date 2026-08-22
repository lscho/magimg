# 幻画 AI

基于 Tauri 2、Vue 3、TypeScript 的桌面端 AI 图片生成工作台，包含 `gpt-image-2` 文生图与图生图、本地图片编辑、AI 抠图与自动分层（本地模型）、PNG/JPEG/WebP 本地图片压缩、提示词模板广场、登录注册、卡密购买与积分兑换、积分日志、支持文生图、图生图与 AI 抠图筛选和分页的创作历史，以及保存目录设置。

自动分层页（`/auto-layer`）采用混合链路：元素框与 AI 抠图共用同一个 `BiRefNet -> 闭合面板先验 -> ViTMatte -> 选区约束` 实现，不再用 SAM 生成正式元素 Alpha；文字框使用 PP-OCRv5 按行生成可编辑单行文字，元素类型由本地识别给出英文 kebab-case 名称。本地关系判断沿用 AI 抠图的最近父级规则并容忍少量贴边误差，元素关系再由精修 Alpha 包含度复核，文字保留几何父级，父层始终位于全部后代下方。每个父级只合并直接子层的高召回 Alpha，文字使用真实字形 Alpha 做有界扩张；只要父素材存在需要清除的直接子层，就统一使用 Big-LaMa 在子层移除蒙版内修复，纯色、渐变和闭合 UI 面板不再切换到确定性曲面/扩散。AI 抠图的独立背景修复采用相同的强制 Big-LaMa 策略；整页背景草稿与整页云背景仍使用自动分层的独立链路。Big-LaMa 已纳入自动分层必需资源，缺失时阻止运行，不再静默回退为大面积颜色扩散。

AI 抠图与自动分层画布共用“智能框选”入口。点击后只通过桌面原生 ONNX Runtime 复用自动分层的 Apache-2.0 SAM 2.1 Hiera Base+：整图只编码一次，再以 12x12 均匀网格顺序发送 144 个独立前景点，按可调 predicted-IoU 阈值和固定遮罩稳定度 `0.80` 过滤候选，并只保留提示点所在的连续区域。鼠标悬停或键盘聚焦“智能框选”按钮会显示“智能框选强度”滑杆，范围 `0.80–0.99`、默认 `0.95`，数值越高候选越少；设置在当前应用会话内由 AI 抠图和自动分层共用。多个候选经面积过滤和框级去重后最多一次写入 32 个元素矩形选区；每个框按长边 8% 向四周外扩，单边限制为 8–32px，以覆盖素材描边、阴影和低分辨率遮罩边界。该操作不会登录、扣积分、上传图片或继续运行 BiRefNet、ViTMatte、OCR 和分层任务。已有选区时需确认后整体替换，整次替换只占一条撤销记录。已安装自动分层 SAM 资源时不增加下载；缺失时首次使用会确认下载固定的 115.3 MiB SAM 2.1 资源，浏览器预览保持按钮禁用。SAM 不限制 COCO 类别，适合提出游戏角色、道具、插画与不规则 UI 素材，但可能生成部件级嵌套框或遗漏极小控件，结果仍可继续手动增删。旧 YOLOS 智能框选模型不再下载或加载，历史本地文件不会主动删除。

整页生成式修复严格把洋红框选作为唯一删除依据。提示词不会把人物、文字、图标、按钮或面板等类别当成全页删除条件；未框选内容以及与框选目标同类的未框选对象必须保留。框内只额外清除所选前景附属的描边、发光、反射、完整阴影和残片，再从同页未选场景恢复连续背景。

父素材细节只使用本地修复，不再被云端结果覆盖。整页背景只在修复蒙版占比不超过 18%，且颜色集中度、平均梯度和强边缘占比同时证明它是小面积纯色或缓渐变时才本地完成；大面积挖空、浅色插画、山水、建筑或其他结构性背景必须向 `/auto-layer-tasks` 上传原始整页图的传输副本和顶级素材/文字框坐标，不发送蒙版；本地链式修复稿只作为云任务失败时的页面草稿。传输副本达到 2 MiB（服务端上限更小时为上限的 75%）后，会与本地分层推理并行使用桌面原生编码器生成质量 88、原尺寸的 WebP；只有体积确实变小时才采用，编码失败或无收益且原图未超上限时回退原图。客户端按长边 5%（8–48px）为阴影与描边外扩选框，只有较小框至少 65% 被另一框覆盖时才视为叠加并保留面积最大的一个；外扩后沿任一主轴至少 50% 连续相交的 UI 框合并为一个云修复区，但合并后的单区不得超过整页面积 8%（原始单框已超过时保持单框），避免整排导航等连续控件被模型误判为应保留界面，服务端再次执行相同去重和限幅合并以兼容旧客户端。服务端保留完整整页空间关系，在每个合并框内部叠加半透明洋红着色和实线边框；大图按 `gpt-image-2` 可靠像素边界等比缩放，必要时只在整页外侧补齐合法请求画布，上游表单不含独立 `mask` 字段。提示词把每个洋红着色像素都定义为必须替换的区域，要求一次调用彻底移除人物、文字、面板、导航、分隔线、描边、完整阴影和残片，并根据同一整页未选场景重建连续的山体、云、水流、建筑线条、渐变与光照。服务端只裁掉请求 padding、恢复原图尺寸并返回未预混合的完整生成页，不提前把结果混回原图；客户端以未压缩原图为基准，只用全部修复框外的匹配像素稳健估计生成页到原图的全局 RGB 映射，不从框内按钮、文字或其他前景采样，再只在每个去重顶级框各自的 5% 阴影扩展联合区域内向内羽化采纳校色后的生成 RGB；大合并框之间未被这些独立扩展框覆盖的区域与框外像素逐像素保留原图，避免生成页整体偏色形成矩形色带，以及阴影残留、未选元素误删、传输压缩、黑边、本地涂抹块或整页坐标误判进入正式背景。云背景完成前只显示原图；失败时保留不可预览草稿并允许只重试背景。完整结果可导出 `preview.png`、`background.png`、透明素材、`texts.json` 和 schema v1 `manifest.json`；底部“打包保存”菜单统一提供“保存为 PSD”和“保存为文件夹”，后者通过目录选择器递归授权后创建项目目录及 `assets/` 子目录。PSD 导出会保留当前画布尺寸、图层位置和尺寸、前后顺序、显隐状态，并把背景固定为根级最底层、父子关系写成图层组；文字层同时写入当前外观像素和可编辑文字描述，打开后即使本机缺少映射字体仍保留导出时的视觉内容。分层结果初始不选中任何图层；结果侧栏的“还原全部位置与大小”会一次恢复所有图层的原始框选坐标和尺寸。桌面端可保存最多 50 条选区记录；分层文档仍只在页面会话中存在，浏览器预览不能保存或恢复选区、运行模型或导出项目目录。

右侧分层结果画布不绘制图层选框、焦点框或缩放手柄，当前图层只在图层列表和属性区高亮。素材使用移动鼠标指针并可直接拖动；文字使用文本鼠标指针，可拖动且双击后就地编辑。图层缩放统一使用属性区滑杆，避免控制框遮挡成品预览。

当前质量策略还会在精修 Alpha 确实越过紧选框边缘时，仅向触边方向小幅扩展素材导出范围。通过四边闭合校验的 UI 面板在 AI 抠图与自动分层中使用同一内部先验，面板外突出的人物、发丝和装饰继续由 BiRefNet 的软 Alpha 保留。透明素材导出会清除透明像素隐藏 RGB，并对软边缘做背景色去污染，减少白边与残色。自动字重不会输出 `700`：普通中文 UI 和带描边、阴影的小字默认使用 `400`，只有极强粗体证据才提升到 `600`。无蒙版整页框选图控制在 3,686,400 像素可靠边界内；若低于最小像素、未对齐 16px 步进或超过 3:1，只在整页外添加深色 padding。半透明洋红着色保留框内原始语义和整页空间关系，响应裁掉画布 padding 后按原框完整映射，不做内缩拉伸。

AI 抠图页对矩形选区中的复合 UI 素材执行闭合面板恢复：客户端先按左右边界校验上下边界，排除选框内横跨整图、但不属于面板的装饰线；确认四周存在显著且连续的矩形或圆角矩形边界后，再从四个真实边角分别估计曲率，只把沿真实圆角向内收缩后的面板内部作为确定前景，与 BiRefNet 人物 Alpha 合并后交给 ViTMatte。精修结束后再次保证该内部不透明。圆角外和头像超出面板区域的原图背景不会被先验填入，面板外突出的人物、发丝和装饰仍使用模型软 Alpha，普通人物选区不会被填成矩形。

自动分层整页云输入会提高半透明洋红标记的覆盖强度，同时把着色下仍可见的原像素定义为不可复刻的受污染证据，降低模型把已框选界面再次生成到背景中的概率。结果展开后，原图与结果画布共同采用两侧自然适配比例的较小值，在 100% 适配状态下保持相同的图片显示尺寸；拖动分隔线时会实时重算，原图的主动缩放和平移仍保持独立。

生产整页框选图固定使用 `248/255` 的近不透明洋红，只保留极少量原像素空间线索，完整面板、人物和文字结构不再作为可复刻证据。云结果只在独立阴影扩展框的联合区域内使用 8–24px 缓出向内羽化；羽化只从图内真实未选区开始，贴住画布边缘的框不会错误混回原前景。Node 回归输入也会强制转为钳位像素数组，避免校色通道溢出产生伪彩色像素。

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

桌面客户端启动时默认最大化，占满当前屏幕的可用工作区，但不进入隐藏系统栏的全屏模式；还原后使用 1520×920 的默认窗口尺寸。macOS 桌面窗口使用原生标题栏 Overlay，系统关闭、最小化和缩放按钮与应用标题位于同一顶部栏。Windows 桌面窗口隐藏原生标题栏和左上角产品图标、名称，在应用顶部栏右侧提供最小化、最大化/还原和关闭按钮；标题栏仍支持拖动、双击最大化和系统边缘吸附。所有桌面平台均禁用 WebView 原生右键菜单，浏览器预览不会模拟系统窗口按钮。

当前项目使用 Tauri 插件：

- `@tauri-apps/plugin-dialog`：选择保存目录、图生图参考图、压缩来源与输出文件夹，以及生成结果的另存为位置。
- `@tauri-apps/plugin-fs`：保存生成图片到本地。
- `@tauri-apps/plugin-http`：在桌面端发送 API 请求和读取远程图片字节，绕过 WebView CORS 限制。
- `@tauri-apps/plugin-os`：识别 Windows/macOS 与 CPU 架构，映射客户端更新平台。
- `@tauri-apps/plugin-opener`：打开输出目录和外部充值支付链接。
- `@tauri-apps/plugin-process`：更新安装完成后重新启动客户端。
- `@tauri-apps/plugin-store`：以 JSON 形式保存设置、历史和登录缓存。
- `@tauri-apps/plugin-updater`：检查、校验、下载并安装签名更新包。

自动分层 PSD 由 MIT 许可的 `ag-psd` 在客户端内存中生成，不经过服务端。

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

自动分层的 BiRefNet、ViTMatte、Big-LaMa、OCR 与命名资源复用 AI 抠图的 `CUTOUT_MODEL_DOWNLOAD_BASE_URL` 下载前缀，当前为 `https://download.atmomo.cn/model`，不增加独立环境变量。服务器需要在该目录部署对应的固定文件名。点击“一键分层”时会统一检查这五类资源；存在缺失项时先确认下载，两组独立资源并行补齐，进度直接显示在主按钮内，全部完成后自动继续分层。SAM 2.1 仅由单独的“智能框选”入口按需检查和安装，不属于正式分层 Alpha 链路。页面不再提供独立资源下载按钮；普通 AI 抠图页仍保持 Big-LaMa 按本地背景修复需求单独下载。

| 部署文件名 | 固定上游地址 | 字节数 | SHA-256 |
| --- | --- | ---: | --- |
| `auto-layer-ocr-det.onnx` | `https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx` | 4,826,518 | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| `auto-layer-ocr-rec.onnx` | `https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/ed152b8b495f84de93cda5709d768548a9127622/inference.onnx` | 16,534,782 | `da72dc72ca4dc220df0dfde68c1dedc31c58d3e76a25871122e5056227d50092` |
| `auto-layer-siglip2-vision-int8.onnx` | `https://huggingface.co/onnx-community/siglip2-base-patch16-224-ONNX/resolve/ba1f3b0843f24bc5417d38e19c37b287d719b2f4/onnx/vision_model_quantized.onnx` | 94,553,333 | `5f2b401c1a4fc095702a5d45348e17ad46c4f87064085365b43c6e8eaa5c0070` |
| `auto-layer-ocr-inference.yml` | `https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_rec_onnx/resolve/ed152b8b495f84de93cda5709d768548a9127622/inference.yml` | 下载时记录 | 下载时记录 |

例如检测模型必须能通过 `https://download.atmomo.cn/model/auto-layer-ocr-det.onnx` 直接访问。客户端会校验三个 ONNX 文件的固定大小与 SHA-256；字符表会在首次安装时记录大小与 SHA-256。后续如需调整统一下载前缀，只修改 `src/constants/cutoutModels.ts` 即可同时作用于 AI 抠图和自动分层资源。

客户端只连接正式 API，不提供本地 Mock 数据。短信认证、模板、积分、图片上传和生成任务都会请求 `VITE_API_BASE_URL` 配置的服务；客户端会自动添加 `/api/client/v1`，该变量也可以直接填写包含基础路径的地址。模板广场和模板选择弹窗使用跟随图片比例的四列瀑布流，较窄窗口自动降为三列、两列或单列；宽屏模板广场会限制超长卡片的最大高度，文生图和图生图预览均完整显示并使用媒体背景承接空余区域，模板弹窗继续按原始比例展示。创作历史继续使用 264×264px 固定卡片的规则网格。图生图模板的对比分割线默认位于左侧 15%，支持拖动查看原图和生成结果；模板信息与操作在悬停或键盘聚焦时显示。

客户端支持手机号登录、短信注册与重置密码、卡密兑换、服务端模板、图生图一次上传 1–3 张有序参考图、输出格式与 JPEG/WebP 压缩率、异步任务轮询和排队任务取消。参考图会分别上传并通过 `inputAssetIds` 创建任务，历史任务重新打开时恢复全部参考图。每次打开模板广场、生成页模板弹窗或创作历史页，客户端都会重新请求对应的模板或服务端任务数据。

浏览器预览使用 `localStorage` 保存登录会话、设置和生成历史，Tauri 桌面端使用 plugin-store 保存同类数据。AI 抠图历史是桌面专属能力，不使用浏览器 `localStorage`、IndexedDB 或 Mock 降级。登录或注册成功后会持久化 Bearer token；下次启动会在界面挂载前恢复未过期 token 并直接注入 API 请求。退出登录、缓存已过期或携带当前 Bearer token 的请求返回 401 时会清除本地会话；旧 token 请求延迟返回的 401 不会覆盖新的登录状态。

文生图与图生图菜单每次切换都会新建空白工作区，并恢复用户设置的默认参数；提示词只有在用户设置默认提示词或主动套用模板时才会自动填入。生成期间切换菜单不会中断任务，预览区右上角会显示最近一个进行中任务，点击后可恢复查看；重新打开客户端时也会从服务端找回该任务并继续查询状态。未登录点击生成会直接打开登录窗口，登录成功后仍需由用户再次确认生成。

结果区提供复制、编辑、AI 抠图、下载和打开默认保存位置操作。文生图与图生图结果都支持右键打开图片菜单，并可从菜单直接进入 AI 抠图；右上角悬浮图标栏也保留 AI 抠图入口。结果出现后的空闲时段会预热 Fabric 和当前原图；点击编辑后读取当前结果并直接跳转到图片编辑页，不再打开弹窗。编辑器支持裁剪、90° 旋转、水平翻转、亮度/对比度/饱和度/灰度调整，以及文字、画笔和仅清除标注的橡皮擦。画布可在适应视图的 25%–400% 范围内缩放，支持滚轮按指针位置缩放，并可使用拖动工具平移底图与全部标注。裁剪面板实时显示原图像素坐标下的选区宽高，也可输入整数尺寸；手动输入会切换到自由比例，选区贴边时边框和控制点保持在图片内。裁剪框允许少量边缘拖动容差并在松手后精确吸附，文字对象支持通过右键菜单删除。编辑结果只在图片编辑页生效，不回写生成任务、结果预览或创作历史。

左侧主导航上方分为两组：文生图、图生图、AI 抠图、自动分层、模板广场与历史记录属于第一组；图片压缩和图片编辑属于第二组，两组使用灰色横线分隔。图片编辑紧跟在图片压缩下方；浏览器预览隐藏桌面专属的图片压缩入口时，图片编辑仍可直接进入。图片编辑页不显示独立页头、外边距或底部状态栏，而是直接显示与生成页一致的两栏工作台：主内容区包含 44px 单列图片工具栏和透明棋盘画布，右侧栏只显示图片尺寸、当前工具属性和“应用编辑”按钮。未载入图片时工具保持禁用，主内容区显示带边框的透明棋盘投放面和“拖放图片”文字；点击投放面仍可选择本地 PNG、JPEG、WebP，桌面 WebView 也支持标准文件拖放。应用后编辑器保持在页面内，可继续修改；图片右键菜单提供“复制”和“另存为”，两项操作均使用最近一次已应用的结果，JPEG/WebP 默认按 0.92 质量导出。该页面的原图、编辑文档和导出 Blob 只在当前页面存活，离开页面后释放，不写入 Pinia、创作历史或服务端。另存为在桌面端会打开系统文件对话框，浏览器预览使用浏览器下载；生成结果图片还支持右键复制、下载、图生图和 AI 抠图。设置了默认保存目录后，结果区会显示打开文件夹按钮。创作历史支持点击任务多选；任务卡右键可打开任务，或对首张结果图执行复制、保存和图生图，四项操作使用同一菜单层级。打开任务会恢复提示词、生成参数、图生图参考图和结果图片；图生图动作则把结果图作为新工作区的参考图。失败或无图片任务可批量删除，仅当所选任务均有结果图片时才显示批量下载。桌面端通过原生 HTTP 客户端读取远程图片并批量保存到所选目录，浏览器预览则使用浏览器的多文件下载。

图片压缩页（`/compress`）是桌面专属的免费本地能力，位于左侧导航第二组首项。页面支持多选图片、拖放图片和递归选择单个源文件夹；文件夹保存时把所选目录作为保存位置，自动创建独立的 `<源文件夹名>-压缩` 文件夹，并在其中保留源文件夹的相对层级，例如 `源根/a/x.png` 保存到 `所选目录/源根-压缩/a/x.png`；同名输出文件夹已存在时自动增加编号。待处理列表按可视区域加载缩略图，鼠标悬停或键盘聚焦可查看不裁切的放大预览。PNG、JPEG、WebP 均保持原格式，不缩放、不上传、不写历史，也不要求登录或扣除积分。为避免单张图片进行多轮质量探测，三种格式都只执行一次有损编码：PNG 使用 `imagequant 4.4.1` 固定 256 色、速度档 6 和 0.5 抖动；JPEG 使用质量 88 的渐进式 `mozjpeg-rs 0.9.2` 与 4:4:4 色度采样；WebP 使用质量 88、method 4、sharp YUV 和无损 Alpha。处理会应用 EXIF 方向，保留 ICC 与 PNG 显示信息，并移除 EXIF、GPS、XMP 和文本隐私元数据；不再运行 DSSIM、无损优化、候选搜索或无损回退。

压缩任务默认自动重命名同名输出并跳过无体积收益的编码结果，也可改为跳过同名文件、覆盖已有输出或强制写出。压缩前不要求选择输出目录；原生端先把结果写入当前会话的临时目录，全部完成后右侧栏显示“保存结果”，此时才打开系统目录选择器并写入用户目录。文件模式选择实际输出目录；文件夹模式选择新输出文件夹的父目录，结果不会直接散落在所选目录中。保存成功使用自动消失的 Toast 提醒，不在结果栏常驻展示保存摘要或目标目录；单项保存失败原因仍显示在对应结果中。单文件模式允许保存目录与源文件目录相同，自动重命名会生成带编号的新文件；原文件在所有策略下都不会被覆盖。文件夹的保存位置不能等于源根或位于源根内部。设置弹窗只保留同名策略与无收益写出行为，不暴露格式或质量参数。每批最多 10,000 张，单文件不超过 256 MiB，单图不超过 64 MP；动画 APNG、动画 WebP、符号链接和隐藏目录会被忽略。原生端根据可用 CPU、编码格式和批次中最大图片尺寸自动使用 1–4 个工作线程；PNG 与 WebP 已有内部线程时降低外层并发，16 MP 以上最多并行 2 张，32 MP 以上改为单张处理，避免过度争抢 CPU 和内存。取消后不再领取新任务，已开始的编码在现有取消检查点退出。浏览器预览隐藏导航入口，直接访问路由只显示桌面能力不可用状态，不提供 Canvas 或 WASM 模拟实现。

AI 抠图页（`/cutout`）在左侧主导航中位于“图生图”下方，也可从文生图/图生图结果区工具栏或图片编辑页右键菜单进入，沿用与生成页一致的两栏布局。页面始终显示透明棋盘工作台；左上侧第一个图标是“导入图片”，点击后直接打开图片选择器，自动分层页沿用同一布局，无图片时也可直接拖入 PNG、JPEG、WebP。矩形框选使用原生 Pointer Capture，绘制时实时跟随指针；不规则素材可使用“点选轮廓”逐点建立多边形，点击起点、双击或按 Enter 闭合，Backspace 撤回最后一点，Escape 取消本次点选。点选轮廓与框选一样由 BiRefNet 提取内部元素：多边形外接框提供裁剪上下文，轮廓只约束最终 Alpha 的最大范围，不会作为直接导出的人工蒙版。多个选区并存，选区上不显示编号或用途文字，删除按钮仅在鼠标悬停或键盘聚焦时出现，并支持单独删除、撤销与重做。框选工具下可拖动选框四条边移动选区，点选轮廓移动时同步平移全部顶点；松手后重新计算嵌套关系并把整次移动写入一条撤销记录。独立选区保持原有透明素材提取；小选区至少 95% 位于大选区且面积小于其 80% 时自动建立最近父子关系，小选区提取前景，大选区合并直接子级遮罩并修复背景。背景修复工具只提供消除笔刷、智能吸附开关和笔刷大小；智能吸附默认关闭。点击工具后无需先激活选框，指针进入任一选框即显示涂抹笔并可直接绘制，首次笔画会把命中的选框设为背景修复，整次操作进入一条撤销历史。

AI 抠图的背景修复固定使用本地链路，右侧不展示本地/云端档位。首次使用时单独按需下载 Big-LaMa，不增加普通抠图资源包体积；修复只合成蒙版内的 RGB，框外与未遮挡像素保持原值，父级精修 Alpha 仍决定最终透明边界。云端背景修复 API 契约保留用于兼容已有服务能力，但不从 AI 抠图正式界面触发。右侧结果以“素材/背景”标记区分类型。

桌面端会在完整抠图成功后把原图、选区关系、矢量笔画和全部透明 PNG 保存到 `appDataDir/cutout-history/`，任务清单由 plugin-store 管理，最多保留最近 100 条。历史 schema v2 会把旧矩形记录兼容迁移为独立前景选区。创作历史中的“AI 抠图”页签支持多选下载和删除；任务卡右键只提供恢复工作和保存全部素材。恢复工作后调整选区、关系或笔画会清空旧结果，再次抠图会重新扣费并新增独立历史任务，不覆盖原记录。浏览器预览不读取、写入或模拟这些记录。

SAM 2.1 模型的 encoder、decoder 及两份 external-data 权重只服务“智能框选”，会逐文件流式写入本地并按固定大小和 SHA-256 校验；不再下载或解压旧 SAM ZIP。智能框选使用 Tauri/Rust 原生 `ort 2.0.0-rc.10` 与 ONNX Runtime 1.22，不加载 `onnxruntime-web` 或 WASM。正式 AI 抠图和自动分层元素 Alpha 都不加载 SAM decoder；每个元素框由 BiRefNet 单次输出软 Alpha，再使用相同的闭合面板先验和 ViTMatte 精修，最后按矩形或多边形选区约束导出。

Windows 的官方 ONNX Runtime 二进制依赖 Microsoft Visual C++ 运行库。桌面正式构建会从目标架构的 MSVC v143 工具链中提取 `Microsoft.VC143.CRT`，并将其中的 DLL 作为 app-local 资源放在主程序同目录；安装和自动更新均不要求用户另行安装 VC++ Redistributable。Windows 打包机必须安装对应架构的 MSVC v143 C++ Build Tools；脚本无法自动定位时，可将 `MSVC_CRT_DIR` 指向目标架构的 `Microsoft.VC143.CRT` 目录。

正式抠图链路把每个选框外扩上下文后缩放到 1024² 运行 BiRefNet，以输出软 Alpha 生成三值 trimap，并在同一选区上下文运行 ViTMatte；同一选区始终保持该数据依赖顺序。trimap 会在裁剪区四边颜色高度集中且 BiRefNet 同时把边界判为背景时锁定纯色背景，包含主体轮廓内与边界同色的封闭孔洞，避免前景膨胀把纯色底误交给 ViTMatte 恢复；ViTMatte 输出后只在该高置信分支的未知带内，用附近确定前景色与背景色的局部混合关系限制近背景色 Alpha，清理抗锯齿白边，确定前景保持不变。普通照片、边界颜色分散或前景铺满边界时不启用这些规则。存在多个选区且设备至少有 8 个逻辑核时，BiRefNet 与 ViTMatte 使用独立原生会话组成双阶段流水线，允许上一选区精修与下一选区粗分割重叠，但每个阶段同时最多运行一个任务；低核设备继续逐选区串行。取消会终止流水线内全部活动 ONNX 运行。闭合面板先验会在粗分割与精修后使用同一规则恢复确定前景，最终 Alpha 再与原图 Alpha 相乘并受矩形或多边形选区约束。自动分层直接调用与 AI 抠图相同的共享函数，因此两处不会再因候选选择、孔洞恢复或面板外轮廓规则不同而产生质量差异。进入 Big-LaMa 背景修复前仍释放 BiRefNet 与 ViTMatte，会话和整页修复链继续串行。每个结果支持单个复制/保存；桌面批量导出只需选择一次目录。浏览器预览保留画布交互，但不能下载或运行本地模型。

截至 2026-07，Meta 官方最新版本是 [SAM 3.1](https://github.com/facebookresearch/sam3)，但其授权权重与运行环境没有适配本项目的原生 encoder/decoder ONNX 契约。当前资源包按桌面 CPU 推理兼容性固定使用以下模型：

| 档位 | 下载大小 | 内置下载地址 |
| --- | ---: | --- |
| BiRefNet Swin-T（AI 抠图与自动分层元素） | 213.6 MiB | [幻画模型镜像](https://download.atmomo.cn/model/) |
| ViTMatte Base（full precision ONNX） | 369.4 MiB | [幻画模型镜像](https://download.atmomo.cn/model/vitmatte-base-composition-1k.onnx) |
| SAM 2.1 Hiera Base+（仅智能框选） | 115.3 MiB | [幻画模型镜像](https://download.atmomo.cn/model/) |

SAM 2.1 ONNX 资源来自 Apache-2.0 许可的 [onnx-community/sam2.1-hiera-base-plus-ONNX](https://huggingface.co/onnx-community/sam2.1-hiera-base-plus-ONNX/tree/bab18593f44e652f04cf18b60b3690f60e8996b0/onnx)，内容固定到提交 `bab18593f44e652f04cf18b60b3690f60e8996b0`，总计 `108676041` 字节，仅用于智能框选自动提议。客户端从幻画模型镜像下载该提交中的 `vision_encoder_quantized.onnx`、`vision_encoder_quantized.onnx_data`、`prompt_encoder_mask_decoder.onnx` 和 `prompt_encoder_mask_decoder.onnx_data`，并按固定大小和 SHA-256 校验。旧 ViT-H、ViT-L、ViT-B 和 MobileSAM 文件不会被主动删除，但客户端不再展示、下载或加载。

资源包同时包含 Apache-2.0 许可的 [Xenova/vitmatte-base-composition-1k](https://huggingface.co/Xenova/vitmatte-base-composition-1k)，全精度 ONNX 文件固定到提交 `1290b014b994e95ca1b9dd9c5f72c3b6d5b7236a`，镜像文件名为 `vitmatte-base-composition-1k.onnx`。客户端校验精确大小 `387371620` 字节和 SHA-256 `f6978437f5068849bcbf49b1f4e37b90aaca5155744e9fde4e6c689f70c2b9ee`。BiRefNet 与 ViTMatte 的统一元素抠图资源入口总下载量为 `611376708` 字节（约 583.1 MiB），底层仍分别使用 `model-manifest.json` 与 `cutout-refiner-manifest.json` 持久化安装状态，因此能跳过已存在的部分并只补齐缺失资源；Base 安装成功后会删除旧 Small 文件，模型不随安装包分发。`tests/cinematic-portrait.webp` 的同输入 CPU 回归中，Base 推理约 2.894 秒，原 Small 约 1.325 秒；两者视觉差异较细微，因此此次替换主要提高复杂边缘的模型容量，同时接受更大的下载体积和约 2.2 倍精修耗时。量化 Base 在该素材上出现发丝缺失、肩部锯齿和暗色边缘色带，未纳入客户端。

AI 抠图的本地背景修复固定使用 Big-LaMa，不增加模型选择项。手工涂抹、智能吸附、子素材移除、纯色、渐变、闭合 UI 面板、复杂纹理、照片和结构背景都使用同一生成式修复链路，笔刷与子级 Alpha 只决定灰度修复蒙版，不再决定模型类型。双框背景的移除蒙版同时合并 ViTMatte 精修 Alpha 和其附近的 BiRefNet 粗蒙版弱响应，并按子元素长边的 2.5% 动态扩张（限制 4–18 px），用于覆盖阴影、描边和发丝碎片；粗蒙版只在子框附近参与合并，不会扩散到父框边缘。模型使用 Apache-2.0 许可的 [Carve/LaMa-ONNX](https://huggingface.co/Carve/LaMa-ONNX/tree/c3c0c9e468934d62e79c329e35d82dd09ff8c444) [lama_fp32.onnx](https://download.atmomo.cn/model/lama_fp32.onnx)，固定提交 `c3c0c9e468934d62e79c329e35d82dd09ff8c444`、大小 `208044816` 字节、SHA-256 `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6`，输入固定为 512×512。客户端以父级精修 Alpha 收紧当前素材的真实内容边界，Alpha 外像素和模型方形留白统一使用素材主背景色，不再拉伸边缘形成条纹；矩形选框余量中的底图和框外图片内容不会进入修复上下文。模型输出再映射回素材边界，本地结果在蒙版核心区完整替换 RGB，羽化区使用偏向修复结果的缓出权重，减少残留阴影与旧前景色，同时逐像素保留蒙版外内容。进入修复阶段前会释放已完成工作的 BiRefNet 与 ViTMatte 会话；原生释放协议同时识别 BiRefNet 与 SAM 会话 ID，嵌套框不会因切换分割模型而中断背景修复。模型使用独立 `cutout-repair-manifest.json`，由用户首次使用背景修复时下载。自动分层的整页背景不属于 AI 抠图链路，继续使用独立的本地草稿与云端生成式修复策略。

本地 UI 背景修复可以脱离应用手动回归。默认用例读取 `tests/background-repair.case.json` 和 `tests/test.png`；宽面板用例使用同一张图验证多个并列挖空区域不会产生卡片宽度色带。脚本复用生产环境的蒙版膨胀、材质分析、曲面重建、调和扩散与本地合成函数：

```bash
npm run test:repair
npm run test:repair -- tests/background-repair.case.json
npm run test:repair -- tests/background-repair-wide-panel.case.json
```

用例中的 `selection` 使用原图坐标，`parentAlpha` 和 `removalMask` 使用相对选框的坐标，支持 `rect`、`roundedRect` 和 `ellipse`。结果写入用例指定的、被 Git 忽略的 `tests/output/` 子目录，包含原始裁剪、灰度蒙版、蒙版叠加图、修复结果和 `diagnostics.json`。诊断文件会记录主背景色、曲面拟合误差、梯度、强边缘比例、兼容样本与空间覆盖率，以及生产逻辑当前会选择曲面、扩散还是 Big-LaMa；当建议使用 Big-LaMa 时，脚本只输出曲面预览用于调试分类阈值，不会在命令行加载 ONNX 模型。

自动分层可直接复用桌面端保存的最新选区记录运行真实 Tauri IPC 和本地 ONNX 链路。默认不请求服务端、不扣积分；`--cloud-input` 额外生成正式云输入与实际传输副本但不提交任务；产物写入 `tests/output/auto-layer/run-*/`，包含 BiRefNet 粗分割与 ViTMatte 精修蒙版、父层修复蒙版、云端整页输入、传输压缩统计、透明素材、OCR 元数据和本地预览。显式传入 `--cloud` 才会在本地推理后创建一次云任务并消耗 20 积分；产物同时保留服务端原始返回和以本地原图框内合成后的正式背景。临时重放非固定质量用例的选区记录时，可同时传入 `--record=<记录 ID> --skip-quality-gate`，质量报告仍会生成，但不会用固定用例断言阻断本次调试。只要客户端 `apiBaseUrl` 明确指向 `localhost` 或 `127.0.0.1`，这些积分属于本地测试数据，自动分层质量调试可直接重复执行 `--cloud`，无需逐次确认；连接非本地 API 时仍须先获得明确授权：

```bash
npm run test:auto-layer
npm run test:auto-layer -- --record=<选区记录 ID>
npm run test:auto-layer -- --cloud-input
npm run test:auto-layer -- --cloud
```

开发服务器会把 `/api/client/v1`、`/images` 和 `/uploads` 代理到 `VITE_API_BASE_URL`，避免浏览器预览受跨域限制。生产 Tauri 应用通过原生 HTTP 插件请求该地址，不受 WebView CORS 限制；浏览器直接访问正式 API 时，后端仍需配置正常的 CORS 响应头。

正式桌面构建设置 `VITE_ENABLE_UPDATER=true` 后，客户端启动时会通过签名更新端点检查新版本。普通更新由用户确认，强制更新会阻断使用；更新包安装完成后客户端立即重启。浏览器预览和未启用 updater 的本地构建不会发起更新请求。发布脚本根据构建时的 `VITE_API_BASE_URL` 生成 `/api/client/v1/version/latest/tauri?platform={{target}}`，生成结果写入 Tauri 构建配置，不跟随设置中可修改的 `apiBaseUrl`。

## 验证命令

```bash
npm run audit:structure
npm run test
npm run test:repair
npm run test:auto-layer
npm run typecheck
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

`audit:structure` 会校验 Vue SFC 区块顺序、组件/视图/composable 命名，并报告超过建议规模的源文件。大文件报告用于识别后续拆分重点；涉及 ONNX 推理、图像编码等高风险模块时，应先按稳定职责和测试边界拆分，不能只为减少行数搬移代码。

## 桌面端自动打包

GitHub Actions 工作流 `.github/workflows/build-desktop.yml` 会在推送 `v*` 版本标签时自动运行，也可以在 Actions 页面输入 SemVer 手动触发。标签中的版本号会写入 Tauri 应用版本。每次构建会分别上传以下 Artifact：

- `huanhua-windows-x64`：Windows x64 NSIS `.exe`，同一文件用于安装和 Tauri v2 updater，并附带 `.exe.sig`。
- `huanhua-windows-arm64`：Windows ARM64 NSIS `.exe`，同一文件用于安装和 Tauri v2 updater，并附带 `.exe.sig`。
- `huanhua-macos-x64`：macOS Intel 磁盘映像、带 `_x64` 后缀的 `.app.tar.gz` updater 包和 `.sig`。
- `huanhua-macos-arm64`：macOS Apple Silicon 磁盘映像、带 `_arm64` 后缀的 `.app.tar.gz` updater 包和 `.sig`。
- `huanhua-desktop-release-manifest`：供后端登记版本使用的 JSON 清单，包含四个平台的文件名、大小、SHA-256、updater 签名和标签发布来源 URL。

构建完成后，`prepare-release` 作业会校验四个平台的普通安装包、updater 包和签名是否齐全；任一产物缺失、签名为空或 GitHub Release 资产重名时发布失败。标签构建随后创建或更新 GitHub Release，再通过 CNB OpenAPI 触发 `.cnb.yml`：CNB 下载该标签的公开 Release 资产，复核仓库、tag、commit、大小、SHA-256 与 updater 签名，然后从国内节点同步到腾讯云 COS/CDN，并通过 HMAC 接口在后台原子登记四个平台草稿。GitHub 会轮询 CNB 到最终状态，CNB 发布失败也会使 GitHub 标签工作流失败。手动构建只生成保留 14 天的 Artifact，不创建 Release 或触发 CNB。完整配置和验收步骤见 [桌面客户端发布流程](docs/desktop-release.md)。

GitHub Actions 会直接读取仓库中的 `.env.production`，并用同一份 `VITE_API_BASE_URL` 生成客户端 API 和 updater 地址。修改正式接口配置后，需要先提交该文件再创建新版本标签。仓库还需要在 GitHub `Settings -> Secrets and variables -> Actions` 配置以下签名值：

- Repository variables：`TAURI_SIGNING_PUBLIC_KEY` 可配置为 Repository Variable，也可放入同名 Repository Secret，工作流会优先读取 Variable。macOS 正式分发还必须配置 `APPLE_SIGNING_IDENTITY`、`APPLE_API_ISSUER` 和 `APPLE_API_KEY`。`APPLE_SIGNING_IDENTITY` 是完整的 `Developer ID Application: 名称 (TEAM_ID)`，另外两项分别是 App Store Connect API 的 Issuer ID 和 Key ID。
- Repository secret：`CNB_TRIGGER_TOKEN`，使用具备 `atmomo/huanhua-client` 访问权和 `repo-cnb-trigger:rw` 权限的 CNB 访问令牌。
- Repository secrets：`TAURI_SIGNING_PRIVATE_KEY` 必须配置；`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 仅在私钥设置了密码时配置。macOS 签名和公证还必须配置 Base64 编码的 `APPLE_CERTIFICATE`、证书导出密码 `APPLE_CERTIFICATE_PASSWORD`，以及 Base64 编码的 App Store Connect `.p8` 私钥 `APPLE_API_KEY_P8`。

COS、CDN 和后台 HMAC 配置保存在 CNB 密钥仓库 `atmomo/huanhua-release-secrets` 的 `desktop-release.yml`，不能提交到代码仓库。发布时根据 `huanhua-desktop-release-manifest.json` 校验并登记产物：Windows 的 NSIS `.exe` 同时用于普通安装和 Tauri v2 updater，macOS 的 `.dmg` 用于普通安装、`.app.tar.gz` 用于 updater。16 MiB 以上文件使用 8 MiB COS 分片、4 路并发和单片重试。COS CAM 身份只应允许目标 bucket 的 `desktop/releases/*` 前缀执行 PutObject、GetObject、InitiateMultipartUpload、UploadPart、CompleteMultipartUpload 和 AbortMultipartUpload，不授予 DeleteObject 或全桶管理权限。

macOS 构建会导入 Developer ID Application 证书，通过 App Store Connect API 完成公证并由 Tauri staple；Windows 当前仍未配置代码签名，直接分发时系统可能显示安全提示。

Windows 使用平台专属的英文产品名 `Huanhua AI`，NSIS 默认安装目录和安装包文件名不包含中文；应用窗口和界面仍显示“幻画 AI”。macOS 继续使用中文产品名。产品名变更后的首个 Windows 版本必须从已有中文目录安装版本执行一次升级与卸载验收，确认旧测试版本不会残留。
