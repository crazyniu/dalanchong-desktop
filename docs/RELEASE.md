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

「多店铺管理」使用软件内按需下载的官方 Ungoogled Chromium。`browser-runtime/engine.json` 固定各平台的官方发行版本、下载地址、SHA-256 与 Mac 应用身份，由 Rust 内嵌读取。主包只包含实现代码与内嵌清单、图标、entitlements、许可证；浏览器二进制由用户点击打开店铺时下载，不进入桌面安装包或更新包。开发版和正式版采用同一运行时安装流程，从 GitHub 官方发行直链下载预编译 DMG／ZIP并核对官方 SHA-256；Mac 本机改名与签名属于安装处理，不编译浏览器源码。

运行时先检查 `assistant-data/browser-runtime/<version>-<sha>-<branding>/`，缺少内核时在软件内显示阶段和下载进度，核对 SHA-256 后安装。Mac 从官方 DMG 只读提取并设置独立应用名称、Bundle ID、图标，以本机 ad-hoc 方式由内到外签名；该本机浏览器签名不能描述为 Developer ID 或公证。Windows 解压官方 ZIP。完整目录发布后继续打开店铺，运行时不依赖 Node、Python、clang 或系统 Chrome。

账号资料使用独立的 `assistant-data/chromium-profiles/<UUID>/`。店铺 UUID、编号、名称与最近打开时间保留；专用内核首次需重新登录。`assistant-data/chrome-profiles/` 仅保留其中用户数据，不读取、覆盖或删除，也不自动导入 Cookie。浏览器程序、账号资料和视频插件程序资源分别保存。`src-tauri/target/` 为 Rust/Tauri 构建产物，`dist-release/` 为交付文件，均不入 Git；源码配置、`Cargo.lock`、`pnpm-lock.yaml` 和 `release-notes/` 保留在仓库。

视频插件唯一维护源码位于本仓库的 `browser-extension/`，开发时直接加载该目录；维护源码保持可读，禁止压缩、混淆或加密。CRX 等分发包需要混淆时，也必须先复制到生成目录，仅处理副本，禁止回写源码。`scripts/package.mjs` 调用 `scripts/prepare-video-extension.mjs`，同步版本并将运行资源复制到 `.work/video-extension/`；使用固定依赖 esbuild 0.27.1 逐文件压缩自有 JS 的空白和局部标识符，再计算 `.work/video-extension.sha256`。`vendor/` 与许可证目录保持原样，不打包 source map、维护 Markdown 或私钥，保留 `THIRD_PARTY_NOTICES.md`、许可证及 LEGAL 资源；不修改开发源码。生成目录和指纹仍映射为 Tauri 的 `video-extension/`、`video-extension.sha256`，不入 Git、不直接维护。

esbuild 使用 `target: chrome116`、`minifyWhitespace: true`、`minifyIdentifiers: true`、`minifySyntax: false`、`keepNames: false`、`sourcemap: false`、`legalComments: inline`；保持文件路径与导入，不 bundle、不改属性名、不删除 Console，不引入 eval 或远程脚本。此步骤是 JS 压缩和局部标识符混淆，不能描述为源码加密。

正式运行从包内按处理后资源的哈希同步到固定的 `assistant-data/browser-extensions/video-downloader/`。专用 Chromium 启动后通过浏览器级 `Extensions.getExtensions`／`Extensions.loadUnpacked` 自动加载该固定路径，已加载时复用。各账号的扩展数据保存在自己的 Chromium profile，插件程序资源与账号数据分开。应用内升级安装前会关闭受管理浏览器，关闭失败则停止安装。视频功能只修改 [插件源码](VIDEO_SOURCES.md)，安装和资源说明以该文档为准，不修改发布资源或用户运行目录。

本机更新签名私钥在忽略目录 `.local/tauri-signing/updater.key`。该文件必须妥善备份；不能删除后为已发布版本随意换公钥。正式发布通过 `TAURI_SIGNING_PRIVATE_KEY` 提供对应私钥，密码通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供。公钥在 `src-tauri/tauri.conf.json`，不是秘密。

Mac 公证发布路径使用 Developer ID 签名并公证，需要 APPLE_SIGNING_IDENTITY、APPLE_API_KEY_PATH、APPLE_API_KEY_ID、APPLE_API_ISSUER。用户已授权发布现有未公证包时，使用下述现有构建产物发布流程，Release 说明保留 Mac 无 Developer ID 签名及公证、Windows 无代码签名等实际限制；Tauri 更新签名继续保留。

## GitHub Actions 手动打包

在 `Tauri Release to Gitee` 工作流中选择已提交工作流的分支，填写与源码版本一致的 `tag` 标识（例如 `v0.3.2`），将 `source_ref` 填为要打包的固定提交 SHA，并保持 `publish=false`。该模式从 `source_ref` 检出源码，`tag` 仅用于版本一致性检查，无需创建或推送版本标签；省略 `source_ref` 时按已有 `tag` 检出。

工作流仅生成 Apple 芯片 Mac arm64 和 Windows x64 安装包，从运行页面的 Artifacts 下载对应 `release-darwin-arm64` 或 `release-win32-x64`。仅打包时不导入 Apple 发布证书、不公证，也不发布 Release 或更新 `latest.json`；Mac 包须按未公证包交付。正式版本标签触发或 `publish=true` 仍使用原有签名、公证和发布流程，`source_ref` 不参与正式发布。

## 发布现有 GitHub Actions 构建产物

用户要求发布已构建版本时，运行 `publish-artifacts.yml`，填写成功构建的 `run_id` 和对应版本 `tag`（例如 `v0.3.2`）；所选构建的 `source_ref` 须与该次运行的 `head_sha` 相同。该流程复用已有产物，不重复构建，也不补做 Developer ID 签名或公证。

1. 从指定成功构建取得 `release-darwin-arm64` 和 `release-win32-x64`，使用原构建的源码 SHA 创建版本 tag。
2. 检查版本与中文更新说明，并核对两个目标的安装文件、大小、哈希和 Tauri 更新签名文件。
3. 将同一批附件及中文说明发布到 Gitee 和 GitHub；完整上传并核对附件后更新 `updates/tauri/latest.json`。

该发布任务使用 Windows runner，最长运行 35 分钟，优先上传 Windows 安装包。发布中断后再次运行时，复用已有 GitHub 草稿和 Gitee 版本，核对已有附件并继续上传缺失文件；匿名下载核对使用 curl，单个附件最长 3 分钟。下载内容与本次产物不一致时停止，不覆盖同名附件。

Gitee 按 tag 查询返回 HTTP 200 且正文为 `null` 时，表示尚无该版本的 Release，发布脚本会创建版本后再上传附件。

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

## 浏览器插件独立发行

`Browser Extension Release` 工作流用 `extension-v<version>` 标签单独生成 CRX3、处理后的 ZIP、SHA256SUMS 和构建身份信息，发布到 GitHub Release，不触发桌面/Gitee发布。源码保持可读；产物复用现有 esbuild 压缩策略，不是不可逆加密。固定签名密钥、扩展 ID、版本及安装限制见 [插件独立发行](EXTENSION_RELEASE.md)。
