# 桌面客户端发布流程

本文说明幻画 AI Windows 和 macOS 客户端从 Git 标签、GitHub Actions 构建，到后端登记并开放自动更新的完整流程。接口响应细节以 [客户端 API 文档](CLIENT_API.md#310-get-versionlatesttauri) 为准。

## 1. 发布产物

每个平台必须同时保留普通安装包和 Tauri updater 包：

| 平台 | 普通安装包 | Tauri updater 包 | updater 签名 |
| --- | --- | --- | --- |
| `windows-x86` | `.exe` | `.nsis.zip` | `.nsis.zip.sig` |
| `windows-arm` | `.exe` | `.nsis.zip` | `.nsis.zip.sig` |
| `macos-x86` | `.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |
| `macos-arm` | `.dmg` | `.app.tar.gz` | `.app.tar.gz.sig` |

`.exe` 和 `.dmg` 用于官网或后台提供的手动下载；`.nsis.zip`、`.app.tar.gz` 和对应 `.sig` 用于客户端自动更新。两类文件不能互换。

## 2. 一次性配置

正式构建读取仓库根目录 `.env.production`：

```bash
VITE_API_BASE_URL=https://api.example.com
VITE_ENABLE_UPDATER=true
VITE_USE_MOCK_API=false
```

GitHub 仓库还需要配置：

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Variable 或 Secret | `TAURI_SIGNING_PUBLIC_KEY` | 写入客户端，用于校验 updater 包 |
| Secret | `TAURI_SIGNING_PRIVATE_KEY` | 构建 updater 包的 `.sig` |
| Secret | `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码；无密码时可不配置 |
| Variable/Secret | Apple 签名与公证字段 | 详见 README 的桌面打包章节 |

私钥只能保存在 GitHub Actions Secrets。更换 updater 密钥会使已经安装的旧客户端无法验证新密钥签出的更新包；若确需轮换，必须先用旧私钥签发一个包含新公钥的过渡版本，再开始使用新私钥。旧私钥已经丢失时，现有客户端无法通过自动更新完成密钥轮换。

## 3. GitHub Actions 流程

推送 `v*` 标签会运行 `.github/workflows/build-desktop.yml`：

1. 从标签提取 SemVer，并写入 Tauri 正式构建配置。
2. 将构建时的 API 地址固化为 `/api/client/v1/version/latest/tauri?platform={{target}}`。
3. 为四个平台构建普通安装包、updater 包和 `.sig`。
4. `prepare-release` 作业检查每个平台恰好存在一套匹配产物；缺包、空签名或重名资产会使流程失败。
5. 生成 `huanhua-desktop-release-manifest.json`，记录文件名、大小、SHA-256、签名和 GitHub Release 来源 URL。
6. 标签构建创建或更新同名 GitHub Release，并上传所有安装包、updater 包、签名和发布清单。

手动运行 workflow 也会生成四个平台 Artifact 和发布清单，但不会创建 GitHub Release。Artifact 保留 14 天。

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
        "fileName": "huanhua_1.2.3_x64-setup.nsis.zip",
        "fileSize": 86123456,
        "sha256": "64 位十六进制 SHA-256",
        "sourceUrl": "https://github.com/owner/huanhua/releases/download/v1.2.3/huanhua_1.2.3_x64-setup.nsis.zip",
        "signatureFileName": "huanhua_1.2.3_x64-setup.nsis.zip.sig",
        "signature": "同名 .sig 文件的完整文本"
      }
    }
  ]
}
```

标签发布时 `sourceUrl` 指向 GitHub Release。若仓库为私有仓库，该地址不能直接提供给未登录客户端；后端必须把文件复制到无需鉴权的 HTTPS 对象存储，再把最终地址写入发布记录。手动构建的 `sourceUrl` 为 `null`。

## 5. 后端登记流程

后端发布工具或管理员按以下顺序处理：

1. 下载 GitHub Release 或 workflow Artifact 中的发布清单和对应文件。
2. 根据清单的 `fileSize` 和 `sha256` 校验下载文件，拒绝不一致的产物。
3. 将普通安装包和 updater 包上传到公开 HTTPS 文件存储。不要解压、重新压缩或修改 updater 包，否则 `.sig` 会失效。
4. 保存 `.sig` 的完整文本；签名来自 CI，不由后端重新生成。
5. 为四个平台分别创建草稿记录，保存版本、两类文件 URL、updater 签名、文件名、文件大小、SHA-256、更新说明和强制更新标记。
6. 发布前对 updater URL 发起实际下载，确认返回的是文件字节而不是 HTML、登录页或 JSON 错误。
7. 原子地把已验证记录设为已发布状态。文件和签名未齐全时禁止发布。
8. 请求 `/version/latest/tauri` 验证四个平台的状态码和响应字段，再用一个旧版本正式客户端完成真实更新。

建议后端发布记录至少包含：

| 字段 | 说明 |
| --- | --- |
| `platform` | 四个平台枚举之一 |
| `version` | 不带 `v` 的 SemVer |
| `installerUrl` | `.exe` 或 `.dmg` 的公开地址 |
| `installerFileName` / `installerFileSize` / `installerSha256` | 普通安装包校验信息 |
| `updaterUrl` | `.nsis.zip` 或 `.app.tar.gz` 的公开地址 |
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
- Windows URL 指向 `.nsis.zip`，macOS URL 指向 `.app.tar.gz`。
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
