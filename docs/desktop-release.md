# 桌面客户端发布流程

本文说明幻画 AI Windows 和 macOS 客户端从 Git 标签、GitHub Actions 构建，到后端登记并开放自动更新的完整流程。接口响应细节以 [客户端 API 文档](CLIENT_API.md#310-get-versionlatesttauri) 为准。

## 1. 发布产物

每个平台必须同时保留普通安装包和 Tauri updater 包：

| 平台 | 普通安装包 | Tauri updater 包 | updater 签名 |
| --- | --- | --- | --- |
| `windows-x86` | `.exe` | 同一个 NSIS `.exe` | `.exe.sig` |
| `windows-arm` | `.exe` | 同一个 NSIS `.exe` | `.exe.sig` |
| `macos-x86` | `.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |
| `macos-arm` | `.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |

Windows 的 NSIS `.exe` 同时用于官网手动下载和 Tauri v2 自动更新，updater 使用同名 `.exe.sig` 验签。macOS 的 `.dmg` 用于手动安装，`.app.tar.gz` 和对应 `.sig` 用于自动更新，两者不能互换。
Tauri 默认会为 Intel 和 Apple Silicon 生成同名的 macOS updater；Actions 会在上传前分别添加 `_x64` 和 `_arm64` 后缀，并同步重命名签名文件，避免 GitHub Release 资产重名。重命名不改变文件内容，不影响 updater 签名。

Windows 构建通过 `src-tauri/tauri.windows.conf.json` 使用英文产品名 `Huanhua AI`，默认安装目录和 NSIS 文件名均为英文；窗口标题仍使用“幻画 AI”。macOS 不应用该覆盖。首次发布英文目录版本时，需要从上一版中文目录安装包完成真实升级和卸载测试，检查旧目录与卸载项是否残留。

原生 AI 抠图使用的官方 ONNX Runtime 1.22 Windows DLL 依赖 MSVC C++ 运行库。`beforeBuildCommand` 会调用 `scripts/prepare-windows-runtime.mjs`，从目标架构的 MSVC v143 工具链中复制完整 `Microsoft.VC143.CRT` DLL 集；Tauri 随后通过 Windows 专属资源映射将这些 DLL 放到应用主程序同目录。该 app-local 部署同时覆盖首次安装和 NSIS 自动更新，无需管理员权限或联网安装前置组件。Windows runner 必须安装对应架构的 MSVC v143 C++ Build Tools；自建 runner 无法自动定位时，应设置 `MSVC_CRT_DIR` 为架构专属的 `Microsoft.VC143.CRT` 目录。

## 2. 一次性配置

正式构建读取仓库根目录 `.env.production`：

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_ENABLE_UPDATER=true
```

GitHub 仓库还需要配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Variable 或 Secret | `TAURI_SIGNING_PUBLIC_KEY` | 写入客户端，用于校验 updater 包 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 构建 updater 包的 `.sig` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；无密码时可不配置 |
| Variable/Secret | Apple 签名与公证字段 | 详见 README 的桌面打包章节 |
| Environment Variable | `TENCENT_COS_BUCKET` / `TENCENT_COS_REGION` | COS bucket 与地域 |
| Environment Variable | `DESKTOP_RELEASE_CDN_BASE_URL` | 公开 HTTPS CDN 基础地址，可包含固定路径前缀 |
| Environment Variable | `DESKTOP_RELEASE_API_URL` | website 的 `/api/internal/desktop-releases` 完整 HTTPS 地址 |
| Environment Secret | `TENCENT_COS_SECRET_ID` / `TENCENT_COS_SECRET_KEY` | 仅有发布前缀权限的 CAM 凭据 |
| Environment Secret | `DESKTOP_RELEASE_WEBHOOK_SECRET` | 与 website 一致、至少 32 字符的 HMAC 密钥 |

COS 和后台登记配置放在名为 `production-release` 的 GitHub Environment 中，并限制为正式版本标签使用。CAM 身份只允许目标 bucket 的 `desktop/releases/*` 前缀执行 PutObject、GetObject、InitiateMultipartUpload、UploadPart、CompleteMultipartUpload 和 AbortMultipartUpload，禁止 DeleteObject 和全桶管理。所有私钥只能保存在 GitHub Actions Secrets。更换 updater 密钥会使已经安装的旧客户端无法验证新密钥签出的更新包；若确需轮换，必须先用旧私钥签发一个包含新公钥的过渡版本，再开始使用新私钥。

## 3. GitHub Actions 流程

推送 `v*` 标签会运行 `.github/workflows/build-desktop.yml`：

1. 从标签提取 SemVer，并写入 Tauri 正式构建配置。
2. 将构建时的 API 地址固化为 `/api/client/v1/version/latest/tauri?platform={{target}}`。
3. Windows 构建按 `x64` 或 `arm64` 暂存 MSVC v143 app-local 运行库；找不到完整 CRT 时立即失败，避免发布启动即报 `MSVCP140.dll` 缺失的安装包。
4. 为四个平台构建普通安装包、updater 包和 `.sig`。
5. `prepare-release` 作业检查每个平台恰好存在一套匹配产物；缺包、空签名或重名资产会使流程失败。
6. 生成 `huanhua-desktop-release-manifest.json`，记录文件名、大小、SHA-256、签名和 GitHub Release 来源 URL。
7. 标签构建创建或更新同名 GitHub Release，并上传所有安装包、updater 包、签名和发布清单。
8. `sync-and-notify` 把制品上传到 `desktop/releases/v<version>/`。1 MiB 以上文件自动使用 1 MiB 分片、4 路并发，每个分片遇到临时网络错误最多尝试 4 次，覆盖所有安装包和 updater。简单上传与完成分片都使用 COS `x-cos-forbid-overwrite`；对象已存在或并发创建时必须同时匹配文件大小和 `x-cos-meta-sha256`，否则发布失败。
9. 通过 CDN HEAD 重新校验公开对象，生成含 CDN URL 和签名文件元数据的最终清单。
10. 使用 `HMAC-SHA256(secret, timestamp + "\n" + sha256(rawBody))` 通知 website，原子创建或更新四个平台草稿。

手动运行 workflow 也会生成四个平台 Artifact 和发布清单，但不会创建 GitHub Release、上传 COS 或登记后台。Artifact 保留 14 天。COS、CDN 或后台接口任一步失败都会使标签 workflow 失败；再次运行同一标签只会校验已有对象并更新未发布草稿。

## 4. 发布清单

发布清单是 CI 与后端之间的机器可读交接文件，不是 Tauri updater 直接读取的响应。结构如下：

```json
{
  "schemaVersion": 1,
  "version": "1.2.3",
  "tag": "v1.2.3",
  "generatedAt": "2026-07-18T12:00:00.000Z",
  "repository": "owner/huanhua",
  "commitSha": "0123456789abcdef",
  "platforms": [
    {
      "platform": "windows-x86",
      "installer": {
        "fileName": "huanhua_1.2.3_x64-setup.exe",
        "fileSize": 87456921,
        "sha256": "64 位十六进制 SHA-256",
        "sourceUrl": "https://github.com/owner/huanhua/releases/download/v1.2.3/huanhua_1.2.3_x64-setup.exe"
      },
      "updater": {
        "fileName": "huanhua_1.2.3_x64-setup.exe",
        "fileSize": 87456921,
        "sha256": "64 位十六进制 SHA-256",
        "sourceUrl": "https://github.com/owner/huanhua/releases/download/v1.2.3/huanhua_1.2.3_x64-setup.exe",
        "signatureFileName": "huanhua_1.2.3_x64-setup.exe.sig",
        "signature": "同名 .sig 文件的完整文本"
      }
    }
  ]
}
```

初始清单的 `sourceUrl` 指向 GitHub Release。`sync-and-notify` 会生成最终清单，把安装包和 updater 的 `sourceUrl` 改为长期公开的 CDN URL，并为 updater 增加 `signatureSourceUrl`、`signatureFileSize` 和 `signatureSha256`。手动构建的初始 `sourceUrl` 为 `null`。

## 5. 后端登记流程

website 的 `POST /api/internal/desktop-releases` 只接受 256 KB 内的 JSON 最终清单，并要求 `X-Release-Timestamp` 与 `X-Release-Signature`。服务端拒绝超过 5 分钟的请求，校验来源仓库、四个平台、SemVer、CDN 固定 origin/path、文件名、大小、SHA-256 和四份 `.sig`，再对所有公开对象执行不跟随重定向的 HEAD 校验。

校验完成后，服务端在单个数据库事务中按 `(platform, version)` 创建或更新四条草稿，固定 `changelog=null`、`isForceUpdate=false`。重复通知只更新草稿；只要一个同版本记录已经发布，整次请求返回 409 且不修改任何记录。管理员随后在后台填写更新说明、确认强制更新选项并发布；登记草稿本身不会改变客户端当前可见版本。

建议后端发布记录至少包含：

| 字段 | 说明 |
| --- | --- |
| `platform` | 四个平台枚举之一 |
| `version` | 不带 `v` 的 SemVer |
| `installerUrl` | `.exe` 或 `.dmg` 的公开地址 |
| `installerFileName` / `installerFileSize` / `installerSha256` | 普通安装包校验信息 |
| `updaterUrl` | Windows NSIS `.exe` 或 macOS `.app.tar.gz` 的公开地址 |
| `updaterFileName` / `updaterFileSize` / `updaterSha256` | updater 包校验信息 |
| `updaterSignature` | `.sig` 完整文本 |
| `changelog` | 更新说明 |
| `isForceUpdate` | 是否阻断旧版本继续使用 |
| `status` / `publishTime` | 草稿、发布状态及发布时间 |

## 6. 发布检查

创建标签前：

- `.env.production` 指向正确的 HTTPS API，且 updater 已启用。
- 标签为合法 SemVer，例如 `v1.2.3`，并且高于已发布客户端版本。
- updater 公私钥匹配，Apple 签名与公证配置有效。

后台发布前：

- 四个平台均有普通安装包、updater 包和匹配签名。
- updater 文件没有经过二次压缩或内容修改。
- 下载 URL 无需 Cookie、Token 或登录，能从公网稳定访问。
- Windows URL 指向已签名的 NSIS `.exe`，macOS URL 指向 `.app.tar.gz`。
- 在未预装 VC++ Redistributable 的干净 Windows x64/ARM64 环境安装并启动，确认不会出现 `MSVCP140.dll`、`VCRUNTIME140.dll` 或 `VCRUNTIME140_1.dll` 缺失提示。
- `/version/latest/tauri` 返回原始 JSON，不套 `{ "data": ... }`。
- 无已发布版本时返回 `204 No Content`，不能返回 `404`。

发布后：

```bash
curl -i "https://api.example.com/api/client/v1/version/latest/tauri?platform=macos-arm"
curl -I "https://download.example.com/path/to/huanhua.app.tar.gz"
```

- 元数据接口返回 `200 application/json`，版本、URL、签名和平台正确。
- updater 包允许 HTTPS 重定向，但最终响应为 `200`，`Content-Length` 与登记大小一致。
- 从上一个正式版本启动客户端时出现更新弹窗，下载、验签、安装和重启均成功。

## 7. 失败与回滚

- 元数据接口 `404`、`500`、超时或返回无效 JSON时，当前客户端会保留现有版本，不会退回普通安装包更新。
- 签名不匹配时 Tauri 会拒绝安装。检查公私钥是否配套，以及 updater 包上传后是否被修改。
- 发布错误版本时应立即撤销该平台记录的发布状态。Tauri 默认不允许自动降级，因此回滚应发布一个版本号更高、内容恢复到稳定状态的新版本。
- 强制更新应最后开启；先完成普通更新验证，避免错误配置阻断所有旧客户端。
