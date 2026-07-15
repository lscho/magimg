# 幻画 AI 后端接口文档

> 版本：v0.3（依据客户端当前实现整理）  
> 更新日期：2026-07-15  
> 适用范围：`client/src/services/apiClient.ts`、`client/src/types.ts` 及当前桌面端页面

## 1. 当前状态与实施范围

当前客户端默认使用 Mock API。相邻的 `api` 项目目前只是 EdgeKV 黑名单示例，**尚未实现本文业务接口**。

接口按客户端现状分为三类：

| 级别 | 含义 | 接口 |
| --- | --- | --- |
| P0 | 当前页面直接调用，首轮联调必须实现 | 登录、注册、退出、积分余额、积分日志、积分套餐、创建充值订单、文生图、图生图 |
| P1 | 客户端已有封装，当前页面暂未调用 | 当前用户、充值订单查询、生成任务查询 |
| P0 新增 | 图生图接入远端后端必须增加 | 参考图上传 |

完整清单：

| 状态 | 方法 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- | --- |
| P0 | POST | `/v1/auth/register` | 否 | 注册并登录 |
| P0 | POST | `/v1/auth/login` | 否 | 登录 |
| P0 | POST | `/v1/auth/logout` | 是 | 退出登录 |
| P1 | GET | `/v1/users/me` | 是 | 获取当前用户 |
| P0 | GET | `/v1/credits/balance` | 是 | 获取积分余额 |
| P0 | GET | `/v1/credits/transactions` | 是 | 获取积分日志 |
| P0 | GET | `/v1/credits/packages` | 否 | 获取充值套餐 |
| P0 | POST | `/v1/credits/orders` | 是 | 创建充值订单 |
| P1 | GET | `/v1/credits/orders/{orderId}` | 是 | 查询支付状态 |
| P0 新增 | POST | `/v1/uploads/images` | 是 | 上传图生图参考图 |
| P0 | POST | `/v1/generations/text-to-image` | 是 | 创建文生图任务 |
| P0 | POST | `/v1/generations/image-to-image` | 是 | 创建图生图任务 |
| P1 | GET | `/v1/generations/{generationId}` | 是 | 查询生成状态 |

## 2. 通用约定

### 2.1 服务地址

- Base URL 通过构建环境变量 `VITE_API_BASE_URL` 配置，例如 `https://api.example.com`。
- 接口路径统一以 `/v1` 开头。
- 当前实现中的 `apiBaseUrl` 在模块加载时从环境变量读取；设置页里的同名字段目前只保存在本地，**不会改变实际请求地址**。

### 2.2 请求格式

- 除上传接口外，请求体使用 `Content-Type: application/json`。
- 上传接口使用 `multipart/form-data`，由客户端运行时自动生成 boundary。
- 受保护接口携带：

```http
Authorization: Bearer <accessToken>
```

- JSON 字段命名以本文为准。生成接口兼容上游 OpenAI 风格的 snake_case 字段；业务响应使用 camelCase。
- 时间字段使用 UTC ISO 8601，例如 `2026-07-15T09:30:00.000Z`。
- 金额使用整数分 `priceCents`、`amountCents`，禁止使用浮点元。

### 2.3 统一响应

所有 JSON 接口，包括错误响应，统一返回：

```json
{
  "code": 0,
  "message": "ok",
  "data": {}
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | integer | 是 | `0` 表示成功，非 `0` 表示业务错误 |
| `message` | string | 是 | 成功为 `ok`，失败为可展示的中文说明 |
| `data` | any \| null | 是 | 成功数据；无数据时为 `null` |

客户端同时检查 HTTP 状态码和 `code`。成功必须为 HTTP 2xx 且 `code = 0`。

### 2.4 错误码

| HTTP | code | 场景 |
| --- | ---: | --- |
| 400 | `40001` | 参数缺失、格式或枚举值错误 |
| 400 | `40002` | 图片类型、大小或内容不符合要求 |
| 401 | `40101` | 未登录、Token 无效或已过期 |
| 403 | `40301` | 无权访问该订单、任务或文件 |
| 402 | `40201` | 可用积分不足 |
| 404 | `40401` | 用户、套餐、订单或生成任务不存在 |
| 409 | `40901` | 邮箱已注册、订单状态冲突等 |
| 422 | `42201` | 模型与生成参数组合不受支持 |
| 429 | `42901` | 请求过于频繁 |
| 500 | `50001` | 服务内部错误 |
| 502 | `50201` | 上游图片模型或支付服务错误 |

错误示例：

```json
{
  "code": 40201,
  "message": "积分不足，请充值后继续生成。",
  "data": null
}
```

## 3. 公共数据结构

### 3.1 User

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 用户唯一 ID |
| `nickname` | string | 是 | 显示名称 |
| `email` | string | 是 | 登录邮箱 |
| `avatarUrl` | string | 否 | HTTPS 头像地址 |

### 3.2 CreditBalance

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `balance` | integer | 是 | 可用积分，最小为 `0` |
| `frozen` | integer | 是 | 已冻结积分，最小为 `0` |
| `updatedAt` | string(date-time) | 是 | 余额更新时间 |

### 3.3 GeneratedImage

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 图片唯一 ID |
| `remoteUrl` | string | 是 | 可由桌面端直接访问和下载的 HTTPS 地址 |
| `width` | integer | 是 | 图片宽度，单位 px |
| `height` | integer | 是 | 图片高度，单位 px |

即使上游模型返回 base64，业务后端也必须将图片保存到对象存储并返回 `remoteUrl`。当前客户端不读取响应中的 `b64_json`。

### 3.4 Generation

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `generationId` | string | 是 | 生成任务唯一 ID |
| `status` | enum | 是 | `queued` / `processing` / `succeeded` / `failed` |
| `costCredits` | integer | 是 | 本次实际扣除积分 |
| `balanceAfter` | integer | 是 | 本次结算后的可用积分 |
| `images` | GeneratedImage[] | 是 | 未完成或失败时为空数组 |
| `errorMessage` | string | 否 | `failed` 时返回失败原因 |
| `created` | integer | 否 | Unix 秒级时间戳 |
| `background` | enum | 否 | `transparent` / `opaque` / `auto` |
| `outputFormat` | enum | 否 | `png` / `jpeg` / `webp` |
| `responseFormat` | enum | 否 | `url` / `b64_json`，仅记录原请求 |
| `quality` | string | 否 | 实际使用的质量参数 |
| `size` | string | 否 | 实际使用的图片尺寸 |
| `usage` | object | 否 | 上游 Token 用量，结构见生成响应示例 |

## 4. 认证接口

### 4.1 注册

`POST /v1/auth/register`

请求：

```json
{
  "email": "demo@huanhua.ai",
  "password": "12345678"
}
```

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `email` | string | 是 | 合法邮箱，建议转小写并去除首尾空格 |
| `password` | string | 是 | 当前客户端最小预期 8 位；后端可执行更强规则 |

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "accessToken": "jwt-or-opaque-token",
    "user": {
      "id": "user_001",
      "nickname": "幻画用户",
      "email": "demo@huanhua.ai",
      "avatarUrl": "https://cdn.example.com/avatars/user_001.png"
    }
  }
}
```

### 4.2 登录

`POST /v1/auth/login`

请求体和成功响应与注册相同。账号或密码错误统一返回 `40101`，不要暴露邮箱是否存在。

### 4.3 退出登录

`POST /v1/auth/logout`

无请求体。服务端应吊销当前 Token 或对应会话。

```json
{
  "code": 0,
  "message": "ok",
  "data": null
}
```

### 4.4 当前用户

`GET /v1/users/me`

成功响应的 `data` 为 [User](#31-user)。客户端已有请求封装，当前页面尚未调用。

## 5. 积分与充值接口

### 5.1 查询余额

`GET /v1/credits/balance`

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "balance": 1200,
    "frozen": 0,
    "updatedAt": "2026-07-15T09:30:00.000Z"
  }
}
```

客户端初始化时即使未登录也会请求本接口，并忽略 `40101`；登录成功后会再次请求。

### 5.2 查询积分日志

`GET /v1/credits/transactions?limit=50`

`limit` 默认为 `50`，服务端应限制在 `1-100`。成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "credit_001",
      "kind": "generation",
      "amount": -7,
      "balanceAfter": 1193,
      "description": "图片生成 · 1 张",
      "createdAt": "2026-07-15T09:30:00.000Z",
      "referenceId": "gen_001"
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 流水唯一 ID |
| `kind` | enum | 是 | `recharge` / `generation` / `refund` / `bonus` / `adjustment` |
| `amount` | integer | 是 | 正数为收入，负数为支出 |
| `balanceAfter` | integer | 是 | 本笔流水完成后的余额 |
| `description` | string | 是 | 面向用户的简短中文说明 |
| `createdAt` | string(date-time) | 是 | 流水发生时间 |
| `referenceId` | string | 否 | 关联订单、生成任务或调整记录 ID |

结果按 `createdAt` 倒序返回。生成扣费、失败退款与充值入账必须和余额变更处于同一事务中。

### 5.3 查询套餐

`GET /v1/credits/packages`

套餐列表为公开接口。

```json
{
  "code": 0,
  "message": "ok",
  "data": [
    {
      "id": "creator",
      "title": "创作包",
      "credits": 1800,
      "bonusCredits": 200,
      "priceCents": 4900,
      "currency": "CNY",
      "recommended": true
    }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 套餐 ID |
| `title` | string | 是 | 展示名称 |
| `credits` | integer | 是 | 基础积分 |
| `bonusCredits` | integer | 是 | 赠送积分，无赠送时为 `0` |
| `priceCents` | integer | 是 | 人民币分 |
| `currency` | string | 是 | 当前固定为 `CNY` |
| `recommended` | boolean | 否 | 是否展示推荐标记 |

### 5.4 创建充值订单

`POST /v1/credits/orders`

请求：

```json
{
  "packageId": "creator"
}
```

响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "id": "order_001",
    "packageId": "creator",
    "amountCents": 4900,
    "credits": 2000,
    "status": "pending",
    "paymentUrl": "https://pay.example.com/orders/order_001",
    "createdAt": "2026-07-15T09:30:00.000Z",
    "expiresAt": "2026-07-15T09:45:00.000Z"
  }
}
```

`credits` 是基础积分和赠送积分之和。客户端会使用系统浏览器打开 `paymentUrl`。

安全要求：价格和到账积分必须由后端按 `packageId` 查询，不能接受客户端传入的金额。支付回调必须验签并保证积分入账幂等。

> 当前充值弹窗允许未登录用户点击套餐，但本接口必须鉴权以确保积分归属。前端联调时需要同步增加登录拦截。

### 5.5 查询充值订单

`GET /v1/credits/orders/{orderId}`

返回结构与创建订单相同。`status` 可为：

| status | 含义 |
| --- | --- |
| `pending` | 等待支付 |
| `paid` | 已支付并完成积分入账 |
| `expired` | 已过期 |
| `cancelled` | 已取消 |

客户端已有请求封装，当前页面尚未轮询。后续可在外部支付返回应用后查询状态并刷新余额。

## 6. 参考图上传接口

### 6.1 上传图片

`POST /v1/uploads/images`

Content-Type：`multipart/form-data`

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `file` | binary | 是 | PNG / JPEG / WEBP；建议最大 20 MB |

请求示例：

```bash
curl -X POST "https://api.example.com/v1/uploads/images" \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@reference.png"
```

成功响应：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "uploadId": "upload_001",
    "url": "https://cdn.example.com/uploads/upload_001.png",
    "mimeType": "image/png",
    "width": 1024,
    "height": 1024,
    "sizeBytes": 845231,
    "expiresAt": "2026-07-16T09:30:00.000Z"
  }
}
```

图生图请求使用 `uploadId`，不要传本机绝对路径。上传文件只能由所有者使用，并应设置有效期和服务端内容检测。

> 当前客户端尚未调用本接口，而是将 Tauri 选择出的 `referenceImagePath` 直接放入 JSON。远端服务无法读取用户电脑上的路径，联调图生图前必须完成客户端上传流程。

## 7. 图片生成接口

### 7.1 模型参数约束

| 模型 | size | n | quality | 其他 |
| --- | --- | ---: | --- | --- |
| `gpt-image-2` | `auto`, `1024x1024`, `1536x1024`, `1024x1536`, `2048x2048`, `2048x1152`, `3840x2160`, `2160x3840` | 1 / 2 / 4 / 8 | `auto`, `low`, `medium`, `high` | 当前客户端固定使用；支持 background、moderation、output_format |

后端必须按模型校验参数组合，不支持的组合返回 `42201`。

客户端不再提供模型选择，所有新生成请求固定发送 `gpt-image-2`。服务端仍应校验模型字段，其他模型按兼容策略处理或返回 `42201`。

`gpt-image-2` 也支持符合约束的其他尺寸：最大边不超过 `3840px`，两边均为 `16px` 的倍数，长短边比不超过 `3:1`，总像素在 `655360-8294400` 之间。当前客户端只开放上表中的常用预设。

### 7.2 创建文生图任务

`POST /v1/generations/text-to-image`

GPT Image 请求示例：

```json
{
  "prompt": "A cinematic fantasy castle on a lake at sunset",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "background": "auto",
  "moderation": "auto",
  "output_compression": 85,
  "output_format": "webp",
  "partial_images": 0,
  "quality": "auto",
  "stream": false,
  "user": "end-user-123"
}
```

字段说明：

| 字段 | 类型 | 必填 | 约束/说明 |
| --- | --- | --- | --- |
| `prompt` | string | 是 | `gpt-image-2` 最大 32000 字符 |
| `model` | enum | 是 | 见模型参数约束 |
| `n` | integer | 是 | 见模型参数约束 |
| `size` | enum | 是 | 见模型参数约束 |
| `background` | enum | 条件 | GPT Image：`auto` / `transparent` / `opaque` |
| `moderation` | enum | 条件 | GPT Image：`auto` / `low` |
| `output_compression` | integer | 条件 | `gpt-image-2` 官方范围 0-100；当前客户端限制 1-100；仅 JPEG / WEBP 发送 |
| `output_format` | enum | 条件 | GPT Image：`png` / `jpeg` / `webp` |
| `partial_images` | integer | 否 | GPT Image，0-3；仅流式协议有意义 |
| `quality` | enum | 是 | `auto` / `low` / `medium` / `high` |
| `stream` | boolean | 否 | 当前客户端只支持 JSON，必须传 `false` |
| `user` | string | 否 | 用于安全审计的终端用户标识，不作为鉴权用户 ID |

### 7.3 创建图生图任务

`POST /v1/generations/image-to-image`

```json
{
  "prompt": "保留构图，改成电影感雪山城堡",
  "model": "gpt-image-2",
  "n": 1,
  "size": "1024x1024",
  "background": "auto",
  "moderation": "auto",
  "output_compression": 85,
  "output_format": "webp",
  "quality": "auto",
  "stream": false,
  "uploadId": "upload_001",
  "strength": 0.55,
  "preserveComposition": true
}
```

除文生图字段外，新增：

| 字段 | 类型 | 必填 | 约束/说明 |
| --- | --- | --- | --- |
| `uploadId` | string | 是 | 参考图上传接口返回的 ID |
| `strength` | number | 否 | 0.1-1.0，默认 `0.55`；越大改动越明显 |
| `preserveComposition` | boolean | 否 | 默认 `true`；是否尽量保留原图构图 |

`strength` 和 `preserveComposition` 是幻画业务参数，不保证能直接透传给上游模型；后端负责映射到提示词或上游支持的编辑参数。

为兼容客户端迁移，可在过渡期接收 `referenceImagePath`，但它只能表示后端可访问的上传 ID 或 URL，**不能是用户电脑本地路径**。新实现统一使用 `uploadId`。

### 7.4 创建任务响应

两个生成接口返回相同结构。后端可同步等待生成完成，也可立即返回异步任务。

同步成功示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "generationId": "gen_001",
    "status": "succeeded",
    "costCredits": 7,
    "balanceAfter": 1193,
    "images": [
      {
        "id": "img_001",
        "remoteUrl": "https://cdn.example.com/outputs/img_001.png",
        "width": 1024,
        "height": 1024
      }
    ],
    "created": 1784107800,
    "background": "opaque",
    "outputFormat": "png",
    "quality": "auto",
    "size": "1024x1024",
    "usage": {
      "input_tokens": 128,
      "input_tokens_details": {
        "image_tokens": 0,
        "text_tokens": 128
      },
      "output_tokens": 1024,
      "total_tokens": 1152,
      "output_tokens_details": {
        "image_tokens": 1024,
        "text_tokens": 0
      }
    }
  }
}
```

异步受理示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "generationId": "gen_001",
    "status": "queued",
    "costCredits": 7,
    "balanceAfter": 1193,
    "images": []
  }
}
```

> 当前页面提交后直接展示响应中的 `images`，尚未轮询。首轮联调建议后端同步返回 `succeeded`；若采用异步任务，前端必须接入查询接口后再上线。

扣费要求：

- 服务端计算费用，不能信任客户端展示的“预计消耗”。
- 创建任务与冻结/扣减积分必须具备原子性，防止并发透支。
- 任务失败时应退还冻结积分，并在任务查询结果中反映最终 `balanceAfter`。
- 建议后续增加 `Idempotency-Key` 请求头，避免网络重试导致重复任务和重复扣费。

### 7.5 查询生成任务

`GET /v1/generations/{generationId}`

成功响应的 `data` 为 [Generation](#34-generation)。客户端已有请求封装，当前页面尚未调用。

失败任务示例：

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "generationId": "gen_001",
    "status": "failed",
    "costCredits": 0,
    "balanceAfter": 1200,
    "images": [],
    "errorMessage": "图片生成服务暂时不可用"
  }
}
```

建议轮询间隔为 2 秒，并由服务端通过 `Retry-After` 告知下次查询时间。任务终态为 `succeeded` 或 `failed`。

## 8. 当前客户端与契约差异

以下项目不是后端可以单独解决的接口定义问题，联调前需要同步处理：

| 问题 | 当前行为 | 联调要求 |
| --- | --- | --- |
| 设置页 API 地址 | 设置值只写本地存储，请求仍使用构建时环境变量 | 明确只支持构建配置，或让请求层读取设置值 |
| 图生图参考图 | 发送 `referenceImagePath` 本机路径 | 先上传文件，再发送 `uploadId` |
| 流式生成 | UI 可开启 `stream`，请求层只调用 `response.json()` | 首版禁用流式；后续单独实现 SSE/流读取 |
| 异步生成 | 已封装任务查询，但页面不轮询 | 首版同步完成，或补充页面轮询 |
| 支付状态 | 已封装订单查询，但页面不轮询 | 支付返回应用后查询订单并刷新积分 |
| 充值鉴权 | 未登录也能打开充值弹窗并创建订单 | 创建订单前要求登录 |
| base64 响应 | UI 只使用 `remoteUrl` | 后端统一落盘并返回 HTTPS URL |
| Token 过期 | 请求层只抛出普通错误 | 后续增加 401 清理会话和重新登录流程 |

## 9. 联调验收清单

- 所有响应均符合 `{ code, message, data }`，错误响应也能解析为 JSON。
- 注册、登录返回的 Token 可用于所有受保护接口，退出后 Token 立即失效。
- 套餐金额和积分由服务端决定；支付回调重复到达不会重复加积分。
- 余额不足时返回 HTTP 402 / `40201`，不创建上游生成任务。
- 各模型的尺寸、数量、质量等参数得到正确校验。
- 生成成功始终返回客户端可访问的 `remoteUrl`、正确宽高和结算后余额。
- 图生图使用上传 ID，不依赖客户端本地文件路径。
- 用户只能访问自己的上传文件、订单和生成任务。
- 同步模式下生成接口返回 `succeeded`；异步模式上线前客户端已接入任务轮询。
- CDN 图片允许 Tauri/WebView 加载，并支持桌面端通过 `fetch` 下载保存。
