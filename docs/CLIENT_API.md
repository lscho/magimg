# 幻画 AI 客户端 API 文档

> 适用版本：当前仓库 `server/api/client/v1` 实现。基础路径为 `/api/client/v1`。
> 请求/响应字段默认使用 **camelCase**；生成任务中的 `output_compression` 沿用 OpenAI 字段名。ID 使用 **字符串**，时间使用 **ISO 8601**。
> 客户端 Bearer token 与 `/api/auth/login` 返回的管理员 token **不通用**。

---

## 1. 概述

### 1.1 基础约定

| 项 | 约定 |
| --- | --- |
| 基础路径 | `/api/client/v1` |
| 字段命名 | 默认 camelCase（如 `templateId`、`createdAt`）；OpenAI 风格生成字段使用 snake_case |
| ID 类型 | 对外一律为字符串（`"3"`、`"1"`），内部为数字 |
| 时间类型 | Unix 秒级存储，对外序列化为 ISO 8601 字符串（如 `2026-07-16T00:00:00.000Z`） |
| 请求体 | JSON 接口 `Content-Type: application/json`；上传接口为 `multipart/form-data` |
| 成功响应 | 各端点约定的 JSON 对象（见下文） |
| 错误响应 | `createError` 返回 `{ "statusCode": <code>, "message": "<中文说明>" }`；4xx 为请求/输入错误，仅下游或配置故障才返回 5xx |

### 1.2 通用分页包装

列表类接口统一返回 `ClientPagination<T>`：

```json
{
  "items": [],        // T 数组
  "total": 0,         // 符合条件的总条数
  "page": 1,          // 当前页（≥1）
  "pageSize": 20      // 每页条数（1–100）
}
```

分页参数（query）：`page`（默认 1）、`pageSize`（默认 20，最大 100）。部分端点使用不同的默认 `pageSize`。

### 1.3 端点一览

**公共接口（无需认证）**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `POST` | `/auth/sms/send` | 发送注册或找回密码验证码 |
| `POST` | `/auth/register` | 手机号 + 验证码 + 密码注册（初始积分 0） |
| `POST` | `/auth/login` | 手机号 + 密码登录，返回 30 天 Bearer token |
| `POST` | `/auth/password/reset` | 校验短信验证码并重置密码 |
| `GET` | `/capabilities` | 生图计费、上传与尺寸限制等平台能力 |
| `GET` | `/template-categories` | 已启用模板分类（含可见模板计数） |
| `GET` | `/templates` | 已发布模板分页列表 |
| `GET` | `/templates/:id` | 已发布模板详情 |
| `GET` | `/version/latest` | 指定平台的最新普通安装包 |
| `GET` | `/version/latest/tauri` | 指定平台的最新 Tauri 签名更新包 |

**鉴权接口（需 `Authorization: Bearer <token>`）**

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/me` | 当前用户与积分余额 |
| `POST` | `/auth/logout` | 撤销当前会话 |
| `POST` | `/cards/redeem` | 兑换卡密充值积分 |
| `GET` | `/points` | 积分流水分页 |
| `POST` | `/uploads/images` | 上传输入图片（JPEG/PNG/WebP，≤5 MB） |
| `POST` | `/tasks` | 创建生成任务（需幂等键） |
| `GET` | `/tasks` | 当前用户任务分页与筛选 |
| `GET` | `/tasks/:id` | 当前用户任务详情 |
| `POST` | `/tasks/:id/cancel` | 取消排队中任务并退款 |

---

## 2. 认证与通用机制

### 2.1 Bearer 鉴权

需在请求头携带：

```http
Authorization: Bearer <client-token>
```

- Token 由登录/注册成功后返回，会话有效期 **30 天**（`client-auth.ts` 中 `SESSION_SECONDS = 30 * 24 * 60 * 60`）。
- 服务端仅存储 token 的 SHA-256 哈希；每次请求按 `sha256(token)` 查 `ls_user_session`，校验 `revoked_time IS NULL` 与 `expire_time`。
- 客户端 token 与管理员 token 体系独立，不可跨用。

`requireClientUser(event)` 的鉴权结果：

| 情形 | 状态码 | message |
| --- | --- | --- |
| 缺少/格式错误的 `Authorization` | 401 | `请先登录` |
| 会话不存在 / 已撤销 / 已过期 | 401 | `登录已过期` |
| 用户不存在或 `status !== 99` | 403 | `账号已停用` |

> 会话活跃期间每 300 秒自动刷新 `last_seen_time`，不影响 token 有效期。

### 2.2 输入校验规则

客户端接口复用以下校验器（位于 `server/utils/client-input.ts`、`password.ts`、`sms-verification.ts`）：

| 校验器 | 规则 | 违反时错误 |
| --- | --- | --- |
| `assertInputObject` | 必须是非 null、非数组的对象 | 400 `请求参数格式无效` |
| `assertMainlandPhone` | 中国大陆手机号 `/^1[3-9]\d{9}$/u` | 400 `手机号格式无效` |
| `optionalText(v, max)` | 可选文本，空值返回 `undefined`；超长报错 | 400 `文本参数格式无效` |
| `parseClientId(v, label)` | 正整数（`/^[1-9]\d*$/u` 且安全整数） | 400 `${label}格式无效` |
| `assertSmsCode` | 6 位数字 `/^\d{6}$/u` | 400 `请输入 6 位短信验证码` |
| `assertPassword` | 字符串，长度 8–128 | 400 `密码长度必须为 8 到 128 个字符` |

- 登录手机号仅支持中国大陆格式；登录已切换为手机号模式，不接受用户名/邮箱。
- 密码使用 scrypt 保存（`scrypt$v1$...`）；迁移回填的 legacy-md5 账号在首次成功登录时自动升级为 scrypt。

### 2.3 限流

普通接口使用进程内令牌桶限流 `assertRateLimit(event, scope, limit, windowSeconds)`：

- 限流维度：`scope` + 客户端 IP（含 `x-forwarded-for`）。
- 超出阈值返回 **429** `请求过于频繁，请稍后重试`。

各端点阈值：

| scope | 限流 | 窗口 |
| --- | --- | --- |
| `client-login` | 12 次 | 60 秒 |
| `client-register` | 8 次 | 60 秒 |
| `client-password-reset` | 8 次 | 60 秒 |
| `card-redeem` | 10 次 | 60 秒 |
| `task-create` | 30 次 | 60 秒 |

短信发送使用独立限流体系（`sms-verification.ts`）：

- 同手机号 **60 秒冷却**；每小时最多 **5** 条；每天最多 **10** 条。
- 同 IP 每小时最多 **30** 条。
- 超出返回 **429** `验证码发送过于频繁，请稍后再试`，并在响应头附 `Retry-After: <seconds>`。
- 验证码有效期 **300 秒**，单码最多校验尝试 **5** 次。

---

## 3. 公共接口（无需认证）

### 3.1 `POST /auth/sms/send`

发送短信验证码。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `phone` | string | 是 | 中国大陆手机号 |
| `purpose` | string | 是 | `register` 或 `passwordReset` |

**成功响应（200）**

```json
{
  "accepted": true,
  "cooldownSeconds": 60,
  "expiresInSeconds": 300
}
```

> 说明：`accepted: true` 表示请求已接受。当 `purpose=passwordReset` 且手机号**不存在**时，服务端仅预消费验证记录、不真正下发短信，但仍返回相同的成功结构（防止手机号枚举）。

**错误码**：400 `验证码用途无效`；409 `该手机号已注册`（仅 `register` 且已存在）；429（短信限流，带 `Retry-After`）；502/503（短信下发失败/服务未配置 `短信服务暂不可用，请稍后再试`）。

---

### 3.2 `POST /auth/register`

手机号 + 验证码 + 密码注册，初始积分 0。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `phone` | string | 是 | 中国大陆手机号 |
| `code` | string | 是 | 6 位短信验证码（用途须为 `register`） |
| `password` | string | 是 | 8–128 字符 |
| `deviceName` | string | 否 | 设备名，最多 100 字符 |

**成功响应（200）**：`ClientAuthResponse`

```json
{
  "user": { "id": "1", "username": "user_8000_ab12cd…", "phone": "13800138000", "points": 0, "status": "active", "createdAt": "2026-07-16T00:00:00.000Z" },
  "token": "<base64url 32 字节 token>",
  "expiresAt": "2026-08-15T00:00:00.000Z"
}
```

**错误码**：400 `请输入 6 位短信验证码` / `验证码无效或已过期`；409 `该手机号已注册`；429（注册限流）。

---

### 3.3 `POST /auth/login`

手机号 + 密码登录，返回 30 天 Bearer token。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `phone` | string | 是 | 中国大陆手机号 |
| `password` | string | 是 | 密码（仅校验字符串类型，长度由存储校验） |
| `deviceName` | string | 否 | 设备名，最多 100 字符 |

**成功响应（200）**：`ClientAuthResponse`（同 3.2）。

**错误码**：400 `请输入密码`；401 `手机号或密码错误`；403 `账号已停用`；429（登录限流）。

---

### 3.4 `POST /auth/password/reset`

校验短信验证码并重置密码，重置后撤销该用户全部旧会话。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `phone` | string | 是 | 中国大陆手机号 |
| `code` | string | 是 | 6 位短信验证码（用途须为 `passwordReset`） |
| `password` | string | 是 | 8–128 字符（新密码） |

**成功响应（200）**

```json
{ "success": true }
```

**错误码**：400 `请输入 6 位短信验证码` / `验证码无效或已过期`；429（重置限流）。

---

### 3.5 `GET /capabilities`

公开读取平台生图能力配置。

**请求**：无参数，无需认证。

**成功响应（200）**：`GenerationSettings`

```json
{
  "textToImageCost": 10,
  "imageToImageCost": 15,
  "cardPurchaseUrl": "https://example.com/cards",
  "maxAttempts": 3,
  "uploadMaxBytes": 5242880,
  "supportedMimeTypes": ["image/jpeg", "image/png", "image/webp"],
  "supportedQualities": ["auto", "low", "medium", "high"],
  "sizeRules": {
    "edgeStep": 16,
    "maxEdge": 3840,
    "maxAspectRatio": 3,
    "minPixels": 655360,
    "maxPixels": 8294400
  }
}
```

`cardPurchaseUrl` 为可选的卡密购买页面地址。客户端仅在该值为有效的 `http` 或 `https` 地址时显示“购买卡密”；Tauri 桌面端使用系统浏览器打开，Web 端使用新窗口打开。

> 默认值除 `cardPurchaseUrl` 外为上例（文生图 10 点、图生图 15 点、最大边 3840、宽高比上限 3、像素下限 655360 / 上限 8294400）。实际值以服务端 `ls_config.name='generation'` 配置为准。

---

### 3.6 `GET /template-categories`

已启用（`status=99`）模板分类列表，含每个分类下「客户端可见模板」计数。

**请求**：无参数，无需认证。

**成功响应（200）**

```json
{
  "items": [
    {
      "id": "1",
      "name": "电商商品",
      "description": "电商主图与详情图",
      "sort": 10,
      "status": "active",
      "templateCount": 8
    }
  ]
}
```

`templateCount` 为可选字段（该分类下客户端可见模板数量）。

---

### 3.7 `GET /templates`

已发布模板分页列表（仅在 `status=99` 的分类下、且满足客户端可见条件：`status=99`、有 `effectImage`、文生图或「图生图且有 `sourceImage`」）。

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | integer | 否 | 默认 1 |
| `pageSize` | integer | 否 | 默认 24，最大 100 |
| `mode` | string | 否 | `textToImage` 或 `imageToImage` |
| `categoryId` | string | 否 | 正整数 ID；若不在可用分类内则返回空列表 |

**成功响应（200）**：`ClientPagination<GenerationTemplate>`。

**说明**：排序为 `sort ASC, id DESC`。指定 `categoryId` 但不在已启用分类内时返回 `{ items: [], total: 0, page, pageSize }`。

**错误码**：400 `生成模式无效`（`mode` 非法）；400 `分类 ID格式无效`（`categoryId` 非法）。

---

### 3.8 `GET /templates/:id`

已发布模板详情。

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 模板 ID（正整数） |

**成功响应（200）**：`GenerationTemplate`（见第 5 节）。

**错误码**：404 `模板不存在`（模板不可见或所属分类未启用）。

---

### 3.9 `GET /version/latest`

查询指定平台最新发布的普通客户端安装包。无需登录；同一平台取 `status=99` 且 `publishTime` 最大的记录，发布新版本不会自动下线旧版本。

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | 是 | `windows-x86` / `windows-arm` / `macos-x86` / `macos-arm` |

**成功响应（200）**：`LatestVersion`

```json
{
  "platform": "windows-x86",
  "version": "1.2.3",
  "downloadUrl": "/uploads/installers/huanhua-win-x86-1.2.3.exe",
  "fileName": "huanhua-win-x86-1.2.3.exe",
  "fileSize": 87456921,
  "changelog": "修复导出崩溃；优化显存占用",
  "isForceUpdate": false,
  "publishTime": "2026-07-16T08:30:00.000Z"
}
```

`downloadUrl` 指向供用户手动安装的 `.exe` 或 `.dmg`。Tauri v2 在 Windows 上直接使用签名后的 NSIS `.exe` 作为 updater，因此 Windows 的普通下载和 updater 可以指向同一文件；macOS 的 `.dmg` 不能替代 `.app.tar.gz` updater 包。

**错误码**：400 `客户端平台无效`；404 `该平台暂无已发布版本`。

---

### 3.10 `GET /version/latest/tauri`

> 后端待补齐：本节定义客户端已经依赖的目标契约。线上路由、发布记录字段和响应行为必须按本节实现后，自动更新链路才完整。

查询指定平台最新发布的 Tauri 签名更新包，供正式桌面客户端启动时自动检查更新。无需登录，响应必须直接使用 Tauri updater 的动态服务格式，不能套业务响应外壳。

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `platform` | string | 是 | `windows-x86` / `windows-arm` / `macos-x86` / `macos-arm` |

客户端平台映射：

| 客户端系统 | `platform` | updater 文件 |
| --- | --- | --- |
| Windows x64 | `windows-x86` | NSIS `.exe` |
| Windows ARM64 | `windows-arm` | NSIS `.exe` |
| macOS Intel | `macos-x86` | `.app.tar.gz` |
| macOS Apple Silicon | `macos-arm` | `.app.tar.gz` |

**服务端选择规则**

1. 校验 `platform` 是否为上述枚举，否则返回 400。
2. 查询该平台 `status=99` 的已发布记录，按 `publishTime DESC` 取第一条。版本号不参与字符串排序。
3. 没有已发布记录时返回 `204 No Content`，响应体必须为空；不能用 404 表示“暂无更新”。
4. 记录存在但 updater URL、签名、文件名或文件大小缺失时返回 503，不得退回普通 `.exe` 或 `.dmg`。
5. 返回最新已发布版本，无需由服务端判断客户端当前版本。Tauri updater 会使用 SemVer 在本地比较，版本不高于当前客户端时不触发弹窗。

**成功响应（200）**

```http
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
```

```json
{
  "platform": "macos-arm",
  "version": "1.2.3",
  "url": "https://api.example.com/uploads/installers/huanhua-macos-arm.app.tar.gz",
  "signature": "dW50cnVzdGVkIGNvbW1lbnQ6...",
  "fileName": "huanhua-macos-arm.app.tar.gz",
  "fileSize": 87456921,
  "notes": "修复导出崩溃；优化显存占用",
  "pub_date": "2026-07-16T08:30:00.000Z",
  "isForceUpdate": false
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | string | 是 | 合法 SemVer，例如 `1.2.3`；不能包含前缀 `v` |
| `url` | string | 是 | updater 文件的绝对 HTTPS 地址；Windows 为签名后的 NSIS `.exe`，macOS 为 `.app.tar.gz` |
| `signature` | string | 是 | 与 `url` 文件匹配的 `.sig` 完整文本，不能返回签名文件 URL |
| `notes` | string | 否 | 更新说明；客户端原样作为纯文本显示 |
| `pub_date` | string | 否 | RFC 3339 时间，例如 `2026-07-16T08:30:00.000Z` |
| `platform` | string | 是 | 本次查询的平台；Tauri 会忽略，幻画客户端用于展示和诊断 |
| `fileName` | string | 是 | updater 包文件名，必须与平台扩展名匹配 |
| `fileSize` | integer | 是 | updater 包字节数，必须为正整数；客户端用于计算下载进度 |
| `isForceUpdate` | boolean | 是 | `true` 时客户端不允许关闭更新弹窗；必须是 JSON boolean，不能是 `1` 或字符串 |

Tauri updater 必需字段是 `version`、`url` 和 `signature`。`notes`、`pub_date` 是 Tauri 标准可选字段；`platform`、`fileName`、`fileSize` 和 `isForceUpdate` 是幻画客户端读取的扩展字段。未知字段可以保留，但不能把全部字段放入 `{ "data": ... }`。

**无已发布版本（204）**

```http
HTTP/1.1 204 No Content
Cache-Control: no-store
```

204 响应不得携带 JSON、空对象、错误对象或其他响应体。Tauri updater 只把 204 识别为正常的“没有可用版本”。

**错误响应**

| HTTP | `message` | 使用场景 |
| --- | --- | --- |
| 400 | `客户端平台无效` | 缺少平台参数或平台不在枚举内 |
| 503 | `更新服务暂不可用` | 已发布记录缺少 updater 包、签名或必要元数据 |

非 2xx 会被 Tauri 视为更新检查失败。404 仅表示路由不存在，不得用于“该平台暂无版本”。错误响应沿用本文通用错误结构，但不能返回 200 加错误对象。

**下载地址要求**

- `url` 必须无需登录、Cookie、Bearer Token 或临时交互即可访问。若使用带有效期的签名 URL，有效期必须覆盖客户端检查、用户阅读更新说明和完整下载所需时间。
- 下载响应必须返回 updater 文件字节，不能返回 HTML、对象存储登录页或 JSON 错误。建议提供准确的 `Content-Length`，可选支持 Range 请求。
- updater 包上传后不得解压、重新压缩或修改任何字节，否则构建时生成的 `.sig` 会失效。
- 元数据建议使用 `Cache-Control: no-store` 或很短的缓存时间；带版本号的 updater 文件可使用长期 immutable 缓存。
- `.sig` 必须来自构建该 updater 包时使用的 Tauri 签名私钥，并与客户端构建中固化的公钥配套。后端不能自行生成或替换签名。

**推荐数据校验**

发布记录由 `huanhua-desktop-release-manifest.json` 导入时，后端应校验平台、版本、文件扩展名、文件大小和 SHA-256。推荐至少保存 `updaterUrl`、`updaterFileName`、`updaterFileSize`、`updaterSha256` 和 `updaterSignature`。完整构建、登记和验收流程见 [桌面客户端发布流程](desktop-release.md)。

响应组装逻辑可以按以下伪代码实现：

```ts
const release = await findLatestPublishedRelease(platform);
if (!release) return emptyResponse(204);

if (!hasCompleteUpdaterMetadata(release)) {
  throw serviceUnavailable("更新服务暂不可用");
}

return {
  platform: release.platform,
  version: release.version,
  url: release.updaterUrl,
  signature: release.updaterSignature,
  fileName: release.updaterFileName,
  fileSize: release.updaterFileSize,
  notes: release.changelog ?? "",
  pub_date: release.publishTime,
  isForceUpdate: release.isForceUpdate
};
```

**联调示例**

```bash
curl -i "https://api.example.com/api/client/v1/version/latest/tauri?platform=macos-arm"
```

联调必须覆盖：四个平台 200、无记录 204、非法平台 400、元数据不完整 503、旧客户端版本比较、签名成功安装，以及签名不匹配时拒绝安装。

---

## 4. 鉴权接口（需 `Authorization: Bearer <token>`）

### 4.1 `GET /me`

返回当前登录用户信息。

**成功响应（200）**：`ClientUser`

```json
{
  "id": "1",
  "username": "user_8000_ab12cd…",
  "phone": "13800138000",
  "points": 120,
  "status": "active",
  "createdAt": "2026-07-16T00:00:00.000Z",
  "lastLoginAt": "2026-07-16T08:30:00.000Z"
}
```

> `phone`、`email`、`lastLoginAt` 为可选字段。`username` 为服务端生成的内部标识，不能用于登录。

**错误码**：401（未登录/过期）；403 `账号已停用`。

---

### 4.2 `POST /auth/logout`

撤销当前会话（服务端标记 `revoked_time`）。

**请求**：无请求体。

**成功响应（200）**

```json
{ "success": true }
```

**错误码**：401（未登录/过期）。

---

### 4.3 `POST /cards/redeem`

兑换卡密，给用户增加积分并将卡密置为已使用。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `code` | string | 是 | 卡密（20 位大写字母数字，允许连字符，内部归一化后比对） |

**成功响应（200）**

```json
{ "points": 100, "balance": 220 }
```

`points` 为本次充值积分，`balance` 为充值后余额。

**错误码**：403 `账号已停用`；404 `卡密不存在`；409 `卡密已被使用` / `卡密已停用`；429（兑换限流）。

---

### 4.4 `GET /points`

当前用户积分流水分页。

**查询参数**：`page`（默认 1）、`pageSize`（默认 20，最大 100）。

**成功响应（200）**：`ClientPagination<PointLedgerEntry>`。

```json
{
  "items": [
    {
      "id": "5",
      "type": "taskCharge",
      "amount": -15,
      "balanceAfter": 105,
      "referenceId": "12",
      "note": "图生图任务",
      "createdAt": "2026-07-16T08:00:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

`type` 取值：`cardRedeem` | `taskCharge` | `taskRefund` | `adminAdjustment`。

---

### 4.5 `POST /uploads/images`

上传输入图片，创建归属于当前用户的 `input` 资源。

**请求**：`multipart/form-data`，字段名 `file`（须带 `filename`）。

**校验**

- MIME 必须为 `image/jpeg` / `image/png` / `image/webp`，且通过魔术字节签名校验。
- 文件大小 ≤ **5 MB**（`MAX_IMAGE_SIZE`）。

**成功响应（200）**：`ClientAsset`

```json
{
  "id": "9",
  "kind": "input",
  "url": "/uploads/images/xxxx.webp",
  "mimeType": "image/webp",
  "size": 123456,
  "createdAt": "2026-07-16T08:00:00.000Z"
}
```

**错误码**：400 `请选择图片`（无文件）；413 `图片不能超过 5 MB`；415 `仅支持 JPEG、PNG 和 WebP 图片`；401（未登录/过期）。

> 上传返回的 `inputAsset.id` 仅属于当前用户，图生图任务必须引用自己上传的资源。模板的 `sourceImage` 仅用于案例对照，不会成为任务输入。

---

### 4.6 `POST /tasks`

创建生成任务。服务端按模式扣费并创建 `pending` 任务。

**请求头**

| 头 | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <token>` |
| `Idempotency-Key` | 是 | 8–100 字符，字符集 `[A-Za-z0-9._:-]+`；重复提交同一 key 返回原任务，不重复扣费 |

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `mode` | string | 否 | `textToImage` 或 `imageToImage`；缺省取模板或 `textToImage` |
| `prompt` | string | 否 | 1–4000 字符；缺省回退到模板 `prompt` |
| `templateId` | string | 否 | 正整数模板 ID |
| `inputAssetId` | string | 否 | 正整数输入图片 ID；`imageToImage` 模式必填 |
| `width` | integer | 否 | 缺省取模板或 1024；须满足 sizeRules |
| `height` | integer | 否 | 缺省取模板或 1024；须满足 sizeRules |
| `quality` | string | 否 | `auto`/`low`/`medium`/`high`；缺省取模板或 `auto` |
| `outputFormat` | string | 否 | `png`/`jpeg`/`webp`；缺省为 `png` |
| `output_compression` | integer | 否 | JPEG/WebP 压缩率（客户端界面名称），范围 0–100；PNG 不接受且客户端不会发送 |

**成功响应（200）**：`GenerationTask`（见第 5 节），初始 `status: "pending"`。

**扣费规则**：文生图按 `textToImageCost`、图生图按 `imageToImageCost` 扣除积分；余额不足返回 409 且不产生任务。

**错误码**：400 `Idempotency-Key 格式无效` / `提示词须为 1 到 4000 个字符` / `模板与生成模式不匹配` / `图片尺寸无效` / `图片质量无效` / `输出格式无效` / `输出压缩质量无效` / `图生图需要先上传参考图片` / `文生图不接受参考图片`；403 `账号已停用`；404 `模板不存在或已下线`；503 `生成服务尚未配置`；429（创建限流）。

---

### 4.7 `GET /tasks`

当前用户任务分页与筛选。

**查询参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `page` | integer | 否 | 默认 1 |
| `pageSize` | integer | 否 | 默认 20，最大 100 |
| `status` | string | 否 | `pending`/`processing`/`succeeded`/`failed`/`cancelled`；非法值 400 |
| `mode` | string | 否 | `textToImage` 或 `imageToImage` |

**成功响应（200）**：`ClientPagination<GenerationTask>`，按 `id DESC` 排序。

**错误码**：400 `任务状态无效`（status 非法）；400 `生成模式无效`（`mode` 非法）；401（未登录/过期）。

---

### 4.8 `GET /tasks/:id`

当前用户任务详情。

**路径参数**

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `id` | string | 是 | 任务 ID（正整数） |

**成功响应（200）**：`GenerationTask`。

**错误码**：404 `任务不存在`（含不属于当前用户的任务）；401（未登录/过期）。

---

### 4.9 `POST /tasks/:id/cancel`

取消排队中任务并退款（`task_refund`）。

**路径参数**：`id`（任务 ID，正整数）。

**成功响应（200）**：`GenerationTask`（取消后最新状态，`status: "cancelled"`）。

**错误码**：404 `任务不存在`；409 `只有排队中的任务可以取消`（仅 `pending` 可取消）；401（未登录/过期）。

---

## 5. 数据模型（DTO）

> 以下类型定义见 `app/types/client.ts`。

### 5.1 枚举 / 字面量联合

| 类型 | 取值 |
| --- | --- |
| `GenerationMode` | `'textToImage'` \| `'imageToImage'` |
| `GenerationTaskStatus` | `'pending'` \| `'processing'` \| `'succeeded'` \| `'failed'` \| `'cancelled'` |
| `TemplateStatus` | `'draft'` \| `'published'` |
| `ClientUserStatus` | `'active'` \| `'disabled'` |
| `PointLedgerType` | `'cardRedeem'` \| `'taskCharge'` \| `'taskRefund'` \| `'adminAdjustment'` |
| 质量档位 | `'auto'` \| `'low'` \| `'medium'` \| `'high'` |

### 5.2 对象类型

```ts
interface ClientUser {
  id: string
  username: string
  phone?: string
  email?: string
  points: number
  status: ClientUserStatus        // 'active' = status 99, 'disabled' = 其他
  createdAt: string                // ISO 8601
  lastLoginAt?: string
}

interface ClientAuthResponse {
  user: ClientUser
  token: string
  expiresAt: string                // ISO 8601
}

interface ClientPagination<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

interface GenerationSettings {
  textToImageCost: number
  imageToImageCost: number
  cardPurchaseUrl?: string
  maxAttempts: number
  uploadMaxBytes: number
  supportedMimeTypes: string[]
  supportedQualities: ('auto' | 'low' | 'medium' | 'high')[]
  sizeRules: {
    edgeStep: number
    maxEdge: number
    maxAspectRatio: number
    minPixels: number
    maxPixels: number
  }
}

interface TemplateCategory {
  id: string
  name: string
  description?: string
  sort: number
  status: 'active' | 'disabled'
  templateCount?: number
}

interface GenerationTemplate {
  id: string
  categoryId: string
  categoryName?: string
  name: string
  description?: string
  mode: GenerationMode
  sourceImage?: string             // 仅 imageToImage 模板返回
  effectImage: string
  prompt: string
  width: number
  height: number
  quality: 'auto' | 'low' | 'medium' | 'high'
  sort: number
  status: TemplateStatus           // 'published' = status 99
  useCount: number
  createdAt: string
  updatedAt: string
}

interface ClientAsset {
  id: string
  kind: 'input' | 'output'
  url: string
  mimeType: string
  size: number
  createdAt: string
}

interface GenerationTask {
  id: string
  requestId: string
  mode: GenerationMode
  prompt: string
  templateId?: string
  inputAsset?: ClientAsset
  outputAsset?: ClientAsset
  width: number
  height: number
  quality: 'auto' | 'low' | 'medium' | 'high'
  pointsCost: number
  status: GenerationTaskStatus
  attemptCount: number
  errorMessage?: string            // 仅 failed 时为 '生成失败，积分已退回'
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

interface PointLedgerEntry {
  id: string
  type: PointLedgerType
  amount: number                   // 正为收入、负为支出
  balanceAfter: number
  referenceId?: string
  note?: string
  createdAt: string
}

interface CardRedeemResult {
  points: number                   // 本次充值积分
  balance: number                  // 充值后余额
}
```

---

## 6. 错误码速查

| 状态码 | message | 常见触发端点 |
| --- | --- | --- |
| 400 | `请求参数格式无效` | 所有 JSON 接口（body 非对象） |
| 400 | `请输入密码` | login |
| 400 | `请输入 6 位短信验证码` | register / password/reset |
| 400 | `验证码无效或已过期` | register / password/reset |
| 400 | `验证码用途无效` | sms/send |
| 400 | `密码长度必须为 8 到 128 个字符` | register / password/reset |
| 400 | `Idempotency-Key 格式无效` | tasks (POST) |
| 400 | `提示词须为 1 到 4000 个字符` | tasks (POST) |
| 400 | `模板与生成模式不匹配` | tasks (POST) |
| 400 | `图片尺寸无效` | tasks (POST) |
| 400 | `图片质量无效` | tasks (POST) |
| 400 | `图生图需要先上传参考图片` | tasks (POST) |
| 400 | `文生图不接受参考图片` | tasks (POST) |
| 400 | `请选择图片` | uploads/images |
| 400 | `任务状态无效` | tasks (GET, status 非法) |
| 400 | `生成模式无效` | tasks (GET/POST, mode 非法) / templates (GET, mode 非法) |
| 400 | `客户端平台无效` | version/latest / version/latest/tauri |
| 400 | `分类 ID格式无效` | templates (GET, categoryId 非法) |
| 401 | `请先登录` | 所有鉴权接口（缺 token） |
| 401 | `登录已过期` | 所有鉴权接口（会话失效） |
| 401 | `手机号或密码错误` | login |
| 403 | `账号已停用` | login / tasks / cards / redeem 等 |
| 404 | `模板不存在` | templates/:id |
| 404 | `任务不存在` | tasks/:id / tasks/:id/cancel |
| 404 | `卡密不存在` | cards/redeem |
| 409 | `该手机号已注册` | sms/send / register |
| 409 | `卡密已被使用` / `卡密已停用` | cards/redeem |
| 409 | `只有排队中的任务可以取消` | tasks/:id/cancel |
| 413 | `图片不能超过 5 MB` | uploads/images |
| 415 | `仅支持 JPEG、PNG 和 WebP 图片` | uploads/images |
| 429 | `请求过于频繁，请稍后再试` | login / register / password/reset / cards / tasks |
| 429 | `验证码发送过于频繁，请稍后再试` | sms/send（带 `Retry-After`） |
| 502 | `短信发送失败，请稍后再试` | sms/send（运营商拒绝） |
| 503 | `短信服务暂不可用，请稍后再试` | sms/send（未配置/故障） |
| 503 | `生成服务尚未配置` | tasks (POST) |
| 503 | `更新服务暂不可用` | version/latest/tauri |

---

## 7. 任务生命周期（服务端附注）

> 以下内容描述服务端内部行为，非客户端请求/响应契约，仅供理解任务状态变化。

- 创建任务即在事务中锁定用户余额并按模式扣费（`task_charge`）；同一 `Idempotency-Key` 重复提交返回原任务，不重复扣费；余额不足返回 409 且不产生任务。
- 后台 Worker 周期性领取 `pending` 任务（MySQL `FOR UPDATE SKIP LOCKED` 防止多实例重复领取），状态流转：`pending` → `processing` → `succeeded` / `failed`。
- 任务失败（`failed`）时服务端原子退款（`task_refund`），客户端在详情中看到 `errorMessage: "生成失败，积分已退回"`。
- 仅 `pending` 状态的任务可由客户端取消（`POST /tasks/:id/cancel`），取消后按 `pointsCost` 退款（`task_refund`）。
- 文生图调用 OpenAI 兼容的 `/v1/images/generations`，图生图调用 `/v1/images/edits`；结果写入存储并登记到 `ls_asset`，任务 `outputAsset` 返回可访问 URL。

---
