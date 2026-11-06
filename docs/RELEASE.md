# 版本发布

桌面运行时为 Tauri 2。源码在 GitHub，安装包和中文 Release 在 https://gitee.com/zhenxiaoguo/dalanchong 。

## 中文更新说明

`package.json.version` 是版本来源。Cargo.toml 同步版本，配置文件从 package.json 读取版本。每次发布写 `release-notes/<version>.md`，固定含「新增功能」「问题修复」，仅写本版实际完成的功能和修复。Release 标题为「大懒虫 <version>」。GitHub、Gitee、升级弹窗使用同一份正文，弹窗渲染 Markdown。

## 本地运行与打包

- `./run.sh`：安装依赖并启动 Tauri 开发版；需要 Node 24、pnpm 11、Rust 1.94+ 和 Xcode Command Line Tools。
- `pnpm package:mac`：当前 Mac 架构的原生 app、DMG、签名更新压缩包。
- `pnpm package:win`：在 Windows x64 生成 NSIS 安装包及更新签名。
- 产物在 `dist-release/tauri/<系统>/<架构>/`，不覆盖旧 Electron 产物。

本机更新签名私钥在忽略目录 `.local/tauri-signing/updater.key`。该文件必须妥善备份；不能删除后为已发布版本随意换公钥。正式发布通过 `TAURI_SIGNING_PRIVATE_KEY` 提供对应私钥，密码通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 提供。公钥在 `src-tauri/tauri.conf.json`，不是秘密。

Mac 正式发布必须 Developer ID 签名并公证，需要 APPLE_SIGNING_IDENTITY、APPLE_API_KEY_PATH、APPLE_API_KEY_ID、APPLE_API_ISSUER。测试包可仅本机签名，需如实标注没有公证。

## 发布流程

1. `pnpm release:prepare --tag v<version>` 检查中文说明及版本。
2. 分别构建 Mac arm64、Mac x64、Windows x64。
3. `pnpm release:publish --tag v<version> --artifacts dist-release/tauri --check` 检查三平台文件、大小、哈希和签名文件一致性。
4. 用户明确要求发布后才执行发布命令或推版本 tag。凭据来自 GH_TOKEN / GITEE_TOKEN，禁止输出。
5. 先上传所有附件并匿名验证下载哈希，再一次性提交 `updates/tauri/latest.json`。元数据包含版本、中文说明、各平台下载地址及 Tauri 签名。

不更新旧 Electron 的 latest.yml。Tauri 签名和 Electron 更新格式不兼容，0.2.x 首次迁移需要安装新版。Gitee 普通附件上限按 100 MiB 预检，不上传超限产物。

## 验证要求

自动启动只检查版本，不下载、不安装。安装前必须停止任务并落盘。测试使用隔离数据目录；不能升级用户正在运行的实例。分别记录启动、版本检查、中文说明、下载、签名校验及安装结果；未发布的版本不能声称线上升级成功。

## 单平台线上测试

用户要求测试在线下载时，手动运行 `publish-local-test.yml`，输入已有版本 tag 和用于检测的旧版本号。该流程只在 Windows x64 构建 NSIS 安装包并生成固定 Tauri 更新签名，以 `--targets win32/x64` 校验并发布 Gitee，公开下载核验后才更新 Tauri latest.json。随后在同一 Windows runner 调用 App 原生更新模块检测、下载并验签一次，保存 result.json，不执行安装或重启。Release 正文注明未提供 Windows 代码签名及支持范围。完整发布仍检查三架构；不得把单平台测试写成三平台正式发布。
