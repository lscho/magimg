# 客户端 API 接入状态与差异

> 对照文档：`docs/CLIENT_API.md`  
> 更新日期：2026-07-17

## 已接入

| 领域 | 接口 | 客户端行为 |
| --- | --- | --- |
| 短信 | `POST /auth/sms/send` | 注册和找回密码发送验证码，并按服务端冷却时间禁用按钮 |
| 认证 | `POST /auth/register`、`POST /auth/login`、`POST /auth/password/reset`、`POST /auth/logout` | 手机号注册、登录、重置密码、撤销会话；401 自动清理本地登录缓存 |
| 用户 | `GET /me` | 恢复会话、刷新用户积分，并更新本地用户缓存 |
| 平台能力 | `GET /capabilities` | 使用服务端计费、卡密购买地址、上传大小、MIME 和质量档位配置 |
| 模板 | `GET /template-categories`、`GET /templates`、`GET /templates/:id` | 模板广场和生成页模板弹窗使用服务端数据；详情接口已封装 |
| 积分 | `GET /points`、`POST /cards/redeem` | 积分日志使用服务端分页数据，充值弹窗改为卡密兑换 |
| 上传 | `POST /uploads/images` | 图生图先读取本地文件并 multipart 上传，再使用 `inputAssetId` 创建任务 |
| 任务 | `POST /tasks`、`GET /tasks`、`GET /tasks/:id`、`POST /tasks/:id/cancel` | 创建任务携带幂等键；store 每 2 秒查询状态并重试临时失败；恢复会话时找回最新进行中任务；排队任务可取消；服务端任务合并到历史记录 |
| 更新 | `GET /version/latest/tauri` | 正式 Tauri 构建启动时按平台检查签名更新；普通更新确认后安装，强制更新阻断使用，安装完成自动重启 |

真实接口基础路径固定为 `/api/client/v1`。`VITE_API_BASE_URL` 可配置为服务端 Origin，也可直接包含该基础路径。

## 已跳过的客户端功能

以下现有客户端能力在 `CLIENT_API.md` 中没有对应字段或端点，因此没有发送到真实接口：

| 客户端能力 | 差异 | 当前处理 |
| --- | --- | --- |
| 付费套餐与支付订单 | 没有套餐、创建订单和订单状态接口 | 真实充值流程使用卡密兑换；卡密购买通过 `capabilities.cardPurchaseUrl` 打开外部页面 |
| 输出格式与压缩比例 | `POST /tasks` 不接受 `outputFormat`、`outputCompression` | 真实模式隐藏这两个控件且不发送；Mock 仍保留演示，实际格式以 `outputAsset.mimeType` 为准 |
| 背景、内容审核、流式与分片 | 不接受 `background`、`moderation`、`stream`、`partialImages` | 不发送 |
| 风格与图生图强度 | 不接受 `style`、`strength`、`preserveComposition` | 不发送 |
| 多图数量 | 单个任务只返回一个 `outputAsset` | 客户端数量固定为 1 |
| 删除服务端任务历史 | 只有任务查询和取消接口，没有删除接口 | 客户端将已删除任务 ID 持久化为隐藏项，使当前设备刷新后不再显示；服务端任务数据本身不会被删除 |

## 仍需后端或产品确认

1. 若要恢复套餐支付，需要补充套餐列表、创建支付订单和订单状态查询接口。
2. 若输出格式、压缩、背景或图生图强度需要由用户控制，需要扩展 `POST /tasks` 请求字段并明确校验规则。
3. 任务查询目前采用 2 秒轮询并持续到终态，临时查询失败不会清除任务。若任务量或耗时继续增长，建议提供服务端推荐轮询间隔或事件推送。
4. 结果区下载已接入桌面“另存为”，默认保存位置可直接打开；当前模式存在成功结果时，生成主按钮显示“重新生成”。放大查看和编辑仍为界面占位。
5. 当前后端响应没有 CORS 允许头。Vite 开发模式通过同源代理访问 API 和资源；Tauri 桌面端下载远程图片使用原生 HTTP 插件，不受 WebView CORS 限制。生产环境的其他 API 请求仍需后端配置允许来源。
6. 自动更新要求后台分别保存普通安装包和 Tauri updater 包，并保存 `.sig` 文本；若 `/version/latest/tauri` 未部署或签名不匹配，客户端会保留当前版本且不会回退到不安全的普通安装器自动替换。
