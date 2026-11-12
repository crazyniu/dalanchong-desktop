# 视频插件来源

视频下载功能源码位于本仓库的 [browser-extension/](../browser-extension/README.md)。功能、界面与平台适配以该目录的说明、[manifest.json](../browser-extension/manifest.json) 和当前实现为准。插件可作为独立 Chrome 扩展运行，多店铺管理也会在各账号的专用 Chromium 中自动加载；软件没有视频下载界面；Mac 本地混剪独立位于「视频混剪」，见[视频混剪](VIDEO_MONTAGE.md)。

## 安装与浏览器入口

在 Chrome 扩展管理页开启开发者模式，通过「加载已解压的扩展程序」选择本仓库的 `browser-extension/` 目录，即可在当前 Chrome 中使用插件。

应用打开账号专用 Chromium 后，通过浏览器级 CDP `Extensions.getExtensions` 查询插件；已经启用且资源指纹一致时复用，未启用或资源变化时调用 `Extensions.loadUnpacked` 加载／重新加载，使用固定绝对路径。用户无需手动安装。店铺冷启动使用明确的非零 loopback CDP 端口，端点记录与 PID 校验见 [多店铺管理](BROWSER.md)；已运行实例不自动重启，新启动参数在正常关闭该店浏览器并再次冷启动后生效。Chromium 冷启动会清除这类安装记录，应用在启动后从同一路径重新加载；扩展 ID 由该路径确定，保持源码或正式资源路径稳定。

每次冷启动前，`browser_extension.rs::pin` 在已关闭账号的 Preferences 中开启扩展开发者模式，补齐插件固定图标和书签栏显示，`chrome.rs` 补齐或原位更新「视频下载」书签，指向实际扩展 ID 的 `manager.html#videos`。保留其他固定扩展与书签；七个平台默认书签仅初始化一次，用户删除后不重新补回。加载后通过 `Extensions.getExtensions` 确认插件已启用，禁用时返回明确错误，不把安装记录当作加载成功。运行中的 Chromium profile 不修改这些设置；重复打开时先恢复／激活店铺窗口，设置 macOS Dock 图标后再同步插件资源；冷启动在插件初始化完成后刷新一次恢复的 HTTP/HTTPS 标签页，重复打开不刷新。

视频监听覆盖所有 HTTP/HTTPS 网页及页面内 iframe，不限制来源页面和视频 CDN 域名。平台详情按钮和电商面板仍按各自的既有适配范围加载。

页面真实请求的成功响应识别为完整视频时直接入库，保留实际类型与完整文件大小。实际播放过的播放器（`!video.paused || video.played.length > 0`，同时 `readyState >= 2`、`videoWidth` 与 `videoHeight` 有效）也可通过 HTTP(S) `video.currentSrc` 捕获并补充尺寸。不扫描未请求地址，不为捕获发送额外探测请求；未取得完整文件长度时保留未知大小。blob 地址、音频、图片、播放清单、接口返回和视频分段不作为整片条目，不捏造完整地址。捕获结果按顶层来源标签页归属。popup 与管理页视频列表在标题下统一使用当前画质的实际播放地址作为链接文字、悬停文本和打开目标，点击在新标签页打开，不区分平台；内部 `sourceUrl` 继续记录来源网页，与标签页归属一同保留。插件图标显示当前扩展会话中已捕获的视频数量，点击打开 `popup.html`，直接显示本浏览器账号全部已捕获视频；弹窗底部「全部下载／下载所选」按全部或所选视频的每组画质直接加入后台队列；顶部「视频溯源」进入 `manager.html` 的已捕获视频视图，展示全部视频并承接所选记录。书签入口继续打开抖音批量解析页。popup 中的「预览」在当前 HTTP/HTTPS 网页中央打开扩展 iframe，与完整管理页复用 `player.js`；iframe 内使用不自动聚焦的普通面板，预览区默认 9:16，以原比例完整显示视频，显式关闭后释放媒体资源与预览容器。预览不主动关闭原 popup 列表，不切换标签页或转移焦点，原列表保留选择与滚动位置；用户点击网页后的 popup 收起遵循 Chrome 原生行为。

应用保留各账号的 Chromium profile 与扩展存储；加载流程按源码指纹复用或重新加载插件，插件业务代码也不在安装事件中清空数据。当前文档记录源码机制，扩展本地存储的跨启动表现仍由用户验收；会话存储随浏览器会话结束。

各账号目录的 `.video-extension-fingerprint` 记录最近加载的资源指纹；开发模式根据源码资源内容计算，正式版使用打包指纹。重新加载沿用原扩展 ID 和存储，不卸载插件。已打开网页需要刷新以使用新的页面脚本。加载同路径刷新插件的方式参考 [Chrome DevTools 官方实现](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/src/tools/extensions.ts)。

详情页下载按钮按视频原始尺寸及 `object-fit`、`object-position` 计算实际画面右上角位置，随页面滚动，角点离屏时隐藏，窄画面内换行。按钮初始不显示大小；只在用户悬停、键盘聚焦对应按钮或点击下载时读取该画质。自动定位及作品／档位变化只更新位置、清除旧显示，不自动请求详情、原画调度或 CDN 文件检查。

## 视频入口源码

| 文件 | 职责 |
| --- | --- |
| `browser-extension/capture.js`、`capture-background.js` | 监听所有 HTTP/HTTPS 网页及 iframe 的完整视频成功响应与已播放且解码成功的 currentSrc，CDN 域名不限 |
| `browser-extension/library.js` | 会话媒体记录、数量角标和下载队列 |
| `browser-extension/messages.js` | `listenMessages` 校验自身扩展消息的 sender 与类型，转发异步处理结果 |
| `browser-extension/popup.html`、`popup.js`、`popup.css` | 本浏览器账号全部已捕获视频列表、单项操作、直接批量下载与管理页入口 |
| `browser-extension/manager.html`、`manager.js` | 抖音批量链接解析、已捕获视频与下载操作 |
| `browser-extension/preview-background.js`、`preview.html`、`preview.js`、`preview.css` | 校验视频记录，在当前网页中央显示扩展 iframe 预览；不自动聚焦，不主动关闭原 popup 列表 |
| `browser-extension/player.js`、`player.css` | 网页预览与管理页共用的播放器、加载反馈与显式关闭 |

## 资源与数据

- 插件版本与桌面端共用 `package.json.version`。Tauri 开发启动、构建及插件资源准备时，`scripts/sync-video-extension-version.mjs` 将该版本写入源码 `browser-extension/manifest.json`；资源复制和哈希计算在同步之后执行。
- `browser_extension.rs` 负责解析开发源码路径、固定扩展 ID 和同步正式版资源，`chrome.rs` 负责浏览器级扩展加载；功能修改集中在本仓库的 `browser-extension/`。
- `scripts/package.mjs` 调用 `scripts/prepare-video-extension.mjs`，将运行资源复制到 `.work/video-extension/`，再使用 esbuild 0.27.1 逐文件压缩自有 JS 空白和局部标识符，最后计算 `.work/video-extension.sha256`；作为 `video-extension/`、`video-extension.sha256` 加入打包配置。`vendor/` 保持原样，不打包 source map 或维护 Markdown，保留第三方声明、许可证和 LEGAL 资源。开发源码不变，文件路径、导入和 Console 保留，不 bundle、不改属性名、不引入 eval／远程脚本；不是源码加密。具体选项见 [发布说明](RELEASE.md)。生成副本不直接维护。
- 正式版从安装包按处理后资源哈希同步到 `assistant-data/browser-extensions/video-downloader/`，以 `.bundle-sha256` 记录当前资源。路径不含版本号；该固定目录只放程序资源，不放账号数据。
- 每个店铺使用独立的 `assistant-data/chromium-profiles/<账号 UUID>/`，浏览器会话与扩展存储按账号隔离。插件媒体记录、解析和下载任务使用会话存储，电商媒体、详情参数及已下载 URL 历史使用本地扩展存储；现有本机业务数据与已下载文件保留。
- 桌面端应用内升级安装前会关闭受管理浏览器，关闭失败则不安装。插件源码随桌面仓库维护和发布，升级后的专用 Chromium 冷启动加载同步后的插件资源，从多店铺管理再次打开时同样比较源码指纹；功能和资源变化由用户测试，只有明确要求打包时才准备发布资源。

打包步骤见 [发布说明](RELEASE.md)，资源映射依据 [Tauri 资源文档](https://v2.tauri.app/develop/resources/)。

## 来源与许可证

仓库保留 [第三方来源](../browser-extension/THIRD_PARTY_NOTICES.md)、[平台来源](../browser-extension/PLATFORM_SOURCES.md) 和完整维护源码；打包资源保留 `THIRD_PARTY_NOTICES.md`、`licenses/`、其他许可证及 LEGAL 资源。维护源码和文档保留在仓库，不加入运行资源。

桌面仓库也保留 [douyin-downloader MIT](../licenses/douyin-downloader-MIT.txt)、[FFmpeg GPL-2.0](../licenses/FFmpeg-GPL-2.0.txt)、[ffmpeg.wasm MIT](../licenses/ffmpeg-wasm-MIT.txt) 和 [hls.js Apache-2.0](../licenses/hls.js-Apache-2.0.txt) 许可文件，不作为临时产物清理。第三方资源的分发遵守各自许可声明。
