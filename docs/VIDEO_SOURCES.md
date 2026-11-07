# 视频插件来源

视频功能的唯一源码位于本仓库的 [browser-extension/](../browser-extension/README.md)。功能、界面与平台适配以该目录的说明、[manifest.json](../browser-extension/manifest.json) 和当前实现为准。插件在各账号的 Google Chrome 中运行，软件没有视频入口或下载界面。

## 自动加载与浏览器入口

应用打开账号 Chrome 后，通过浏览器级 CDP `Extensions.getExtensions` 查询插件；已经加载时复用，未加载时调用 `Extensions.loadUnpacked`，使用固定绝对路径。用户无需手动安装。Chrome 冷启动会清除这类安装记录，应用在启动后从同一路径重新加载；扩展 ID 由该路径确定，保持源码或正式资源路径稳定。

每次冷启动前，`browser_extension.rs::pin` 在已关闭账号的 Preferences 中补齐插件固定图标和书签栏显示，`chrome.rs` 补齐或原位更新「视频下载」书签，指向实际扩展 ID 的 `manager.html#videos`。保留其他固定扩展与书签；七个平台默认书签仅初始化一次，用户删除后不重新补回。运行中的 Chrome profile 不做这类磁盘修改，重复打开只切回已有窗口。

应用保留各账号的 Chrome profile 与扩展存储；加载流程复用已加载插件，插件业务代码也不在安装事件中清空数据。当前文档记录源码机制，扩展本地存储的跨启动表现仍由用户验收；会话存储随 Chrome 会话结束。

## 资源与数据

- 插件版本与桌面端共用 `package.json.version`。Tauri 开发启动、构建及插件资源准备时，`scripts/sync-video-extension-version.mjs` 将该版本写入源码 `browser-extension/manifest.json`；资源复制和哈希计算在同步之后执行。
- `browser_extension.rs` 负责解析开发源码路径、固定扩展 ID 和同步正式版资源，`chrome.rs` 负责浏览器级扩展加载；功能修改集中在本仓库的 `browser-extension/`。
- `scripts/package.mjs` 调用 `scripts/prepare-video-extension.mjs`，将源码复制到 `.work/video-extension/` 并生成 `.work/video-extension.sha256`，作为 `video-extension/` 和 `video-extension.sha256` 加入本次打包配置。生成副本不直接维护。
- 正式版从安装包按源码哈希同步到 `assistant-data/browser-extensions/video-downloader/`，以 `.bundle-sha256` 记录当前资源。路径不含版本号；该固定目录只放程序资源，不放账号数据。
- 每个店铺使用独立的 `assistant-data/chrome-profiles/<账号 UUID>/`，浏览器会话与扩展存储按账号隔离。插件列表记录、解析和下载任务使用会话存储，电商媒体、详情参数及已下载 URL 历史使用本地扩展存储；现有本机业务数据与已下载文件保留。
- 桌面端应用内升级安装前会关闭受管理浏览器，关闭失败则不安装。插件源码随桌面仓库维护和发布，升级后的 Chrome 冷启动加载同步后的插件资源，已运行窗口保持当前插件；功能和资源变化由用户测试，只有明确要求打包时才准备发布资源。

打包步骤见 [发布说明](RELEASE.md)，资源映射依据 [Tauri 资源文档](https://v2.tauri.app/develop/resources/)。

## 来源与许可证

随插件保留 [第三方来源](../browser-extension/THIRD_PARTY_NOTICES.md)、[平台来源](../browser-extension/PLATFORM_SOURCES.md) 及其 `licenses/`；打包资源必须完整保留这些说明与许可证。

桌面仓库也保留 [douyin-downloader MIT](../licenses/douyin-downloader-MIT.txt)、[KS-Downloader GPL-3.0](../licenses/KS-Downloader-GPL-3.0.txt)、[FFmpeg GPL-2.0](../licenses/FFmpeg-GPL-2.0.txt)、[ffmpeg.wasm MIT](../licenses/ffmpeg-wasm-MIT.txt) 和 [hls.js Apache-2.0](../licenses/hls.js-Apache-2.0.txt) 许可文件，不作为临时产物清理。插件的分发与对应源码需遵守其许可声明。
