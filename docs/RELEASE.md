# 版本发布

桌面运行时为 Tauri 2。源码在 [GitHub](https://github.com/crazyniu/dalanchong-desktop)，安装包和中文 Release 在 [Gitee](https://gitee.com/zhenxiaoguo/dalanchong/releases)。

仅在用户要求构建、打包或发布时执行对应步骤。普通修改和文档整理不运行这些命令，也不追加测试或安装；完整开发规则见 [AGENTS.md](../AGENTS.md)。

## 中文更新说明

`package.json.version` 是桌面端与视频插件的唯一版本来源。Cargo.toml 同步版本，Tauri 配置从 package.json 读取版本；`scripts/sync-video-extension-version.mjs` 在开发启动、构建及插件资源准备时同步 `browser-extension/manifest.json`。每次发布写 `release-notes/<version>.md`，固定含「新增功能」「问题修复」，仅写本版实际完成的功能和修复。删除功能时同步清理所有版本说明中的对应描述。Release 标题为「大懒虫 <version>」。发布脚本将该文件正文同时写入 GitHub、Gitee Release 及 `updates/tauri/latest.json` 的 `notes` 字段；升级弹窗从该元数据读取说明并渲染 Markdown。

## 本地运行与打包

- `./run.sh`：安装依赖并启动 Tauri 开发版；需要 Node 24、pnpm 11、Rust 1.94+，macOS 还需 Xcode Command Line Tools。
- `pnpm package:mac`：Apple 芯片 Mac arm64 的原生 app、DMG、签名更新压缩包。
- `pnpm package:win`：在 Windows x64 生成 NSIS 安装包及更新签名。
- 产物在 `dist-release/tauri/<系统>/<架构>/`。

「多店铺」使用本机正常安装的 Google Chrome Stable。macOS 查找系统与用户 Applications 目录，Windows 查找标准 Chrome 安装目录；未安装时引导至 [Google 中国官方下载页](https://www.google.cn/chrome/)。浏览器版本与更新由 Chrome 自身管理。

Chrome 账号数据位于 `assistant-data/chrome-profiles/<UUID>/`，账号列表保存 UUID、编号、名称与最近打开时间。首次使用账号时在网页完成登录，后续使用同一目录。浏览器数据保留在用户本机。`src-tauri/target/` 为 Rust/Tauri 构建产物，`dist-release/` 为交付文件，均不入 Git；源码配置、`Cargo.lock`、`pnpm-lock.yaml` 和 `release-notes/` 保留在仓库。

视频插件唯一源码位于本仓库的 `browser-extension/`。`scripts/package.mjs` 自动调用 `scripts/prepare-video-extension.mjs`，先同步插件版本，再将插件完整复制到 `.work/video-extension/` 并生成 `.work/video-extension.sha256`，作为 `video-extension/` 和 `video-extension.sha256` 加入本次 Tauri 打包配置，保留插件源码、依赖资源、来源说明与许可证。这些生成资源不入 Git，不直接修改。

正式运行从包内按源码哈希同步到固定的 `assistant-data/browser-extensions/video-downloader/`。Chrome 启动后通过浏览器级 `Extensions.getExtensions`／`Extensions.loadUnpacked` 自动加载该固定路径，已加载时复用。各账号的扩展数据保存在自己的 Chrome profile，插件程序资源与账号数据分开。应用内升级安装前会关闭受管理浏览器，关闭失败则停止安装。视频功能只修改 [插件源码](VIDEO_SOURCES.md)，安装和资源说明以该文档为准，不修改发布资源或用户运行目录。

本机更新签名私钥在忽略目录 `.local/tauri-signing/updater.key`。该文件必须妥善备份；不能删除后为已发布版本随意换公钥。正式发布通过 `TAURI_SIGNING_PRIVATE_KEY` 提供对应私钥，密码通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供。公钥在 `src-tauri/tauri.conf.json`，不是秘密。

Mac 公证发布路径使用 Developer ID 签名并公证，需要 APPLE_SIGNING_IDENTITY、APPLE_API_KEY_PATH、APPLE_API_KEY_ID、APPLE_API_ISSUER。用户已授权发布现有未公证包时，使用下述现有构建产物发布流程，Release 说明保留 Mac 无 Developer ID 签名及公证、Windows 无代码签名等实际限制；Tauri 更新签名继续保留。

## GitHub Actions 手动打包

在 `Tauri Release to Gitee` 工作流中选择已提交工作流的分支，填写与源码版本一致的 `tag` 标识（例如 `v0.3.2`），将 `source_ref` 填为要打包的固定提交 SHA，并保持 `publish=false`。该模式从 `source_ref` 检出源码，`tag` 仅用于版本一致性检查，无需创建或推送版本标签；省略 `source_ref` 时按已有 `tag` 检出。

工作流仅生成 Apple 芯片 Mac arm64 和 Windows x64 安装包，从运行页面的 Artifacts 下载对应 `release-darwin-arm64` 或 `release-win32-x64`。仅打包时不导入 Apple 发布证书、不公证，也不发布 Release 或更新 `latest.json`；Mac 包须按未公证包交付。正式版本标签触发或 `publish=true` 仍使用原有签名、公证和发布流程，`source_ref` 不参与正式发布。

## 发布现有 GitHub Actions 构建产物

用户要求发布已构建版本时，运行 `publish-artifacts.yml`，填写成功构建的 `run_id` 和对应版本 `tag`（例如 `v0.3.2`）；所选构建的 `source_ref` 须与该次运行的 `head_sha` 相同。该流程复用已有产物，不重复构建，也不补做 Developer ID 签名或公证。

1. 从指定成功构建取得 `release-darwin-arm64` 和 `release-win32-x64`，使用原构建的源码 SHA 创建版本 tag。
2. 检查版本与中文更新说明，并核对两个目标的文件、大小、哈希和 Tauri 更新签名文件。
3. 将同一批附件及中文说明发布到 Gitee 和 GitHub；完整上传并核对附件后更新 `updates/tauri/latest.json`。

该发布任务使用 Windows runner，最长运行 35 分钟，优先上传 Windows 安装包。发布中断后再次运行时，复用已有 GitHub 草稿和 Gitee 版本，核对已有附件并继续上传缺失文件；匿名下载核对使用 curl，单个附件最长 3 分钟。下载内容与本次产物不一致时停止，不覆盖同名附件。

现有未公证包的发布沿用产物本身的签名状态，更新说明须如实列出限制；完成发布不代表完成真实平台或安装升级验收。

## 重新构建并发布

1. `pnpm release:prepare --tag v<version>` 检查中文说明及版本。
2. 分别构建 Apple 芯片 Mac arm64 和 Windows x64。
3. `pnpm release:publish --tag v<version> --artifacts dist-release/tauri --check` 检查 Mac arm64 和 Windows x64 文件、大小、哈希和签名文件一致性。
4. 在用户已要求发布的范围内执行发布命令或推版本 tag；仅要求打包时到产物交付为止。凭据来自 GH_TOKEN / GITEE_TOKEN，禁止输出。
5. 先上传所有附件并匿名验证下载哈希，再一次性提交 `updates/tauri/latest.json`。元数据包含版本、中文说明、各平台下载地址及 Tauri 签名。

发布脚本按 100 MiB 预检，不上传超限产物。

## 更新行为与验收边界

自动启动通过 Gitee 的 `updates/tauri/latest.json` 检查当前系统和架构的更新，版本与中文说明取自同一份元数据，只检查、不下载、不安装。用户点击「立即更新」后，下载、签名校验、安装和重启连续完成。更新期间禁止启动新任务，已有任务结束后保存运行记录与账号 Cookie；Windows 使用 passive 安装模式，只显示进度并在完成后重新打开软件。开发版只允许检查更新。

验收由用户负责；只有用户明确要求协助测试时才使用隔离数据目录，不能升级用户正在运行的实例。只记录实际执行过的启动、版本检查、中文说明、下载、签名校验及安装结果；未发布的版本不能声称线上升级成功。

## 单平台线上测试

用户要求测试在线下载时，手动运行 `publish-local-test.yml`，输入已有版本 tag 和用于检测的旧版本号。该流程只在 Windows x64 构建 NSIS 安装包并生成固定 Tauri 更新签名，以 `--targets win32/x64` 校验并发布 Gitee，公开下载核验后才更新 Tauri latest.json。随后在同一 Windows runner 调用 App 原生更新模块检测、下载并验签一次，保存 result.json，不执行安装或重启。Release 正文注明未提供 Windows 代码签名及支持范围。完整发布检查 Mac arm64 和 Windows x64；单平台测试结果仅代表该平台。
