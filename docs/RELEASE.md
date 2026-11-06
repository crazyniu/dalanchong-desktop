# 版本构建与 Gitee 发布

源码仓库为 GitHub 公有仓库 [crazyniu/dalanchong-desktop](https://github.com/crazyniu/dalanchong-desktop)，本目录就是仓库根目录。客户端更新说明和安装包使用 Gitee 公有仓库 [zhenxiaoguo/dalanchong](https://gitee.com/zhenxiaoguo/dalanchong/releases)。GitHub Release 的说明与构建产物经发布脚本同步到 Gitee Release。

`appId` 保持 `com.local.ecommerceassistant`、包名保持 `ecommerce-assistant`，显示名称为「大懒虫」。升级不得更改主进程已有的用户数据目录及账号 Session 分区。安装包只带应用代码和图标，不带项目 `.local`、账号、Cookie 或激活数据。仅 `electron-updater` 是运行时 Node 依赖；前端依赖已归入开发依赖，由 Vite 打包。

## 构建

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test:core
pnpm test:license
pnpm test:update
pnpm test:scripts
pnpm build
node scripts/package.mjs darwin arm64
# 在 Intel Mac 或对应 CI 上：
node scripts/package.mjs darwin x64
# 在 Windows 或对应 CI 上：
node scripts/package.mjs win32 x64
```

输出为 `dist-release/<platform>/<arch>/`：Mac 提供 DMG 与 ZIP，Windows 提供 NSIS EXE。默认是无签名构建检查，不发布。`pnpm package:mac` 使用本机架构；`pnpm package:win` 生成 x64。Electron Builder 固定 26.18.0，Electron Updater 固定 6.8.11。

`CI` 工作流在 main 推送或 PR 时只运行代码检查、核心测试与 Web 构建，不自动打包原生应用。原生构建由 `Release to Gitee` 的手动入口或版本 tag 触发，分别使用 macOS arm64、macOS Intel、Windows runner，保存 Actions artifacts。未勾选发布的手动构建为无签名验证包，不作为正式 Mac 自动更新包。

## 更新说明与发布入口

1. 修改 `package.json` 的版本，并创建 `release-notes/<版本>.md`。说明不能为空，正式版使用 `X.Y.Z`。
2. 检查 `pnpm release:prepare --tag v<版本>`。
3. 正式发布时创建并推送对应 `v<版本>` tag；也可以手动运行 `Release to Gitee` 工作流，填写已经存在的 tag，并明确勾选 `publish`。
4. 未勾选 `publish` 的手动工作流只构建，不签名、公证或发布。

发布流程检查 tag、版本、更新说明和所有三个架构的安装包，完整预检文件尺寸与 SHA-512 后，创建 GitHub draft Release、上传产物，创建 Gitee Release 并同步说明和附件。每个 Gitee 附件会匿名下载并核对 SHA-512。附件全部成功后，才公开 GitHub Release，并用一次非强制 Git push 更新 Gitee main 上所有平台的 latest 元数据。

Gitee 目录：

```text
updates/darwin/arm64/latest-mac.yml
updates/darwin/x64/latest-mac.yml
updates/win32/x64/latest.yml
```

客户端下载地址只采用 Gitee 上传接口返回的 `browser_download_url`，不会指向 GitHub。Feed 固定为：

```text
https://gitee.com/zhenxiaoguo/dalanchong/raw/main/updates/{platform}/{arch}/
```

首次发布前 Gitee main 应已初始化；脚本也可以在空仓库先创建一份发行说明 README，直到附件就绪才写 latest。新任务或构建不会覆盖已发布版本。若发布中途失败，latest 保持旧版；排查后先清理本次未完成的 GitHub draft/Gitee Release，再重新运行同一版本。不要删除已正式分发的版本。若失败发生在最后 metadata push 后的网络返回阶段，应先检查远端 main，避免重复发布。

## GitHub Actions Secrets

| Secret | 用途 |
| --- | --- |
| `GITEE_TOKEN` | Gitee 仓库所有者的访问令牌，用于 Release、附件和 main 更新；只存在发布/验证 job |
| `MAC_CSC_LINK` | 含私钥的 Developer ID Application `.p12`，可用 Base64 内容 |
| `MAC_CSC_KEY_PASSWORD` | `.p12` 密码 |
| `APPLE_API_KEY_CONTENTS` | Apple App Store Connect API 私钥 `.p8` 内容 |
| `APPLE_API_KEY_ID` | Apple API Key ID |
| `APPLE_API_ISSUER` | Apple API Issuer ID |

`GH_TOKEN` 由 Actions 的 `github.token` 提供，publish job 需要 `contents: write`。Mac 正式发布使用 `RELEASE_BUILD=true`，必须提供签名与公证配置；缺少配置直接失败。Windows 当前构建未配置代码签名，正式分发前应配置可信的 Windows 签名方案。

Git 推送使用临时 askpass 文件从环境读取令牌，不把令牌写进 URL、客户端配置或输出日志。Apple 私钥仅写入 runner 的临时目录。不要提交任何密钥、真实用户目录或测试授权数据。

可以手动运行 `Validate Gitee access` 工作流，仅验证令牌对应仓库所有者、公有仓库和 main 分支可访问，不创建 tag/Release、不上传附件、不更新 latest。这个检查不代替真正上传与 Git push 的验收。

本地只有预检：

```sh
node scripts/publish-release.mjs --tag v0.2.0 --artifacts dist-release --check
```

## Gitee 限制与官方接口

普通仓库单个 Release 附件不超过 100M，仓库总附件容量不超过 1G；以 [Gitee 官方限制](https://help.gitee.com/repository/release/create) 为准。脚本对所有安装包和 blockmap 全量预检，单文件超过 100 MiB 会明确失败，且不会创建 Release 或更新 latest。Electron 的 Mac ZIP 可能超过此上限：必须先解决 Gitee 额度或减小完整安装包，不能拆卷冒充自动更新 ZIP，也不会自动改用 GitHub 下载。

已核对 [Gitee API v5 官方文档](https://gitee.com/api/v5/swagger) 对应的 `doc_json`：附件上传为 `POST /api/v5/repos/{owner}/{repo}/releases/{release_id}/attach_files`，multipart 字段为 `file` 与 `access_token`；返回字段包含 `id`、`name`、`size` 和 `browser_download_url`。客户端使用完整下载，避免假定 Gitee 附件 URL 能直接拼接 `.blockmap`。
