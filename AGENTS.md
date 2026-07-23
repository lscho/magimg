# AGENTS.md

本文件约束在 `client/` 范围内工作的 AI 编码代理。目标是保持幻画 AI 的业务契约、桌面能力、设计系统和工程质量一致。

## 1. 项目定位

幻画 AI 是基于 Tauri 2、Vue 3 和 TypeScript 的桌面 AI 图像生成工作台。当前功能包括：

- `gpt-image-2` 文生图与图生图参数配置。
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
- 浏览器预览使用 `localStorage` 保存设置、历史和登录会话；Tauri 使用 plugin-store。
- 自动更新仅在正式构建启用，使用独立签名端点，不跟随设置中的 `apiBaseUrl`；浏览器预览不检查更新。
- 结果区已接入复制、本地图片编辑、桌面“另存为”和打开默认保存位置；当前模式存在成功结果时生成主按钮显示“重新生成”。编辑版本只替换当前工作区预览，不写入服务端任务或创作历史。
- 项目目前没有自动化单元测试或 E2E 测试脚本。
- `GeneratorPanel` 固定模型为 `gpt-image-2`、数量为 1、背景为 `auto`。
- 任务接口使用 camelCase 的 `outputFormat`，并仅为 JPEG/WebP 接收 `output_compression`；背景、审核、流式、风格和图生图强度等旧参数仍不接收，差异见 `docs/client-api-integration-gaps.md`。

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
