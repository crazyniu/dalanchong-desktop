# 多店铺管理

侧栏「多店铺管理」使用软件内按需下载的独立 Chromium 管理店铺。每次新建一个店铺并设置名称与浏览器默认尺寸；UUID、编号、登录会话、收藏、标签页和插件数据独立保存。首次打开空白页，重复打开切回原窗口，冷启动恢复上次会话，并在视频插件初始化完成后刷新一次恢复的 HTTP/HTTPS 标签页；重复打开已有窗口不刷新。

## 店铺与操作

- 浏览器源码来自 [ungoogled-software/ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)，二进制来自同一官方组织的 macOS／Windows 发行库，各平台版本由 `browser-runtime/engine.json` 固定：Mac 为 [156.0.8078.79](https://github.com/ungoogled-software/ungoogled-chromium-macos/releases/tag/156.0.8078.79-1.1)，Windows 为 [157.0.8103.38](https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/tag/157.0.8103.38-1.1)。不传指纹伪装参数。Mac 使用 `大懒虫浏览器.app`，显示名「大懒虫浏览器」、Bundle ID `com.local.ecommerceassistant.browser`；Windows 使用便携 `WindowsBrowser/chrome.exe`。浏览器版本和下载 SHA-256 由项目清单固定。
- 每个店铺通过 `--user-data-dir` 指向 `assistant-data/chromium-profiles/<UUID>/`，独立保存登录、会话、收藏与插件数据；各店铺分别管理进程和 CDP 连接。UUID、编号及名称保持不变。专用内核使用新的资料目录，首次需重新登录；`assistant-data/chrome-profiles/` 中的用户数据保留，不读取、覆盖或删除，不自动导入 Cookie。
- CDP 仅连接 `127.0.0.1`。每店冷启动分配明确的非零端口传给专用浏览器，以 `.chrome-debug.json` 保存 `port`、`pid`、`browserPath`。macOS 由 `chrome_process.rs` 读取该 profile 的 `SingletonLock`，通过 `sysctl` 获取持有进程的真实启动参数，确认专用浏览器主进程、相同的规范化 `--user-data-dir` 路径及实际调试端口；从该端口的 `/json/version` 发现浏览器路径，再用 CDP 返回的真实浏览器 PID 核对并更新连接记录。已有端口为 0 的实例通过 `DevToolsActivePort` 取得端口与浏览器路径。只依据同一 profile 的真实进程连接，不扫描端口；保留内核原生 `navigator.webdriver` 行为，不注入或伪造。运行实例不自动重启，新启动参数在正常关闭该店浏览器并再次冷启动时应用。
- macOS 已有活跃 profile 持有进程时，即使 CDP 尚未就绪，也不重写该 profile 或启动另一副本。`Child` 仅表示应用发起启动时取得的进程句柄，其退出不能单独认定浏览器启动失败；启动流程在既有 20 秒期限内等待实际浏览器就绪。关闭流程等待真实 profile 持有进程退出，不能因 CDP 暂时不可连接就认定浏览器已关闭。
- 冷启动时检查已安装的专用浏览器，缺少内核则先完成软件内下载和安装；每次打开先创建或激活该店窗口，立即设置 macOS Dock 图标，再加载／同步视频插件；冷启动在插件初始化完成后刷新恢复的 HTTP/HTTPS 标签页。macOS 关闭最后一个窗口后进程可能仍在运行，再次打开店铺时复用该进程，当前没有页面则创建空白页并加载该店 profile。macOS 冷启动与复用打开时，通过该店已有的浏览器 CDP 连接调用 `Browser.setDockTile`，由 `chrome_dock.rs` 用 `NSImage` 读入 `assets/icons/app.iconset/icon_512x512.png`，在新建的 512 × 512、8 位预乘 RGBA 画布清透明底、绘制源图并叠加红底白字编号，编码 PNG 后作为 `image` 设置小虫 Dock 图标；`badgeLabel` 留空。源图片保持原样，不生成缓存文件，仅更新当前进程内存中的 Dock 界面。对应 [Chromium 实现](https://raw.githubusercontent.com/chromium/chromium/main/chrome/browser/devtools/devtools_dock_tile_mac.mm) 操作 `NSApplication.sharedApplication.dockTile`，该 CDP 操作只更新当前进程的 Dock 图标；应用身份与签名由浏览器本机安装流程维护。卡片编号与网页店铺名称仍用于区分店铺。
- 网页使用内核原生 UA、语言、时区、屏幕、硬件、网络与音视频能力，不传指纹伪装参数。视频播放使用专用内核提供的解码器。
- 右上角提供「新建店铺」，卡片提供打开、编辑店铺与删除店铺操作，显示固定的 #编号和最近打开时间；添加和编辑可设置名称及浏览器默认尺寸百分比；名称可在浏览器运行时修改。
- HTTP/HTTPS 网页显示绿底白字店铺名称（背景与 Logo 同色），默认距左下角边缘 16px，可直接拖拽并限制在视口内，保留 8px 边距；位置仅当前网页保留，刷新后恢复默认。有网页时运行中改名同步更新；该店进程已无网页时只保存名称，下次打开时同步。各平台均显示卡片编号与网页名称标签。
- 各店铺使用独立的浏览器数据目录，与达人邀约的 WebView 账号分别保存会话；Chromium 原生个人资料名称使用「大懒虫 · 店铺名」，冷启动时同步。
- 每次点击打开店铺时，将对应窗口从最小化、最大化或全屏恢复为普通窗口，等待状态转换完成后，按主程序当前屏幕可用区域的宽高乘该店铺保存的百分比并居中。下拉可选 60%、70%、80%、90%，默认 80%；尺寸修改在下次点击打开时生效，不立即调整正在使用的窗口。
- 标签页、地址栏、下载与收藏由专用浏览器原生界面负责。默认平台书签只初始化一次，保留用户后续编辑。
- 视频功能由可独立使用的 Chrome 插件提供，右上角固定图标和「视频下载」书签打开插件入口。加载和资源说明见 [视频插件来源](VIDEO_SOURCES.md)。

## 浏览器资源

`browser-runtime/engine.json` 固定各平台官方发行版本、下载地址、SHA-256 与 Mac 应用身份，由 Rust 内嵌读取。下载使用 GitHub 官方发行直链的预编译 DMG／ZIP，完成后核对官方 SHA-256。点击打开店铺时，`chrome_runtime.rs` 检查 `assistant-data/browser-runtime/<version>-<sha>-<branding>/`；当前品牌目录不存在时，先在同一 `browser-runtime/` 下查找相同上游版本与 SHA-256 的完整引擎，复制并应用当前中文包名、图标和签名到新目录，回报安装阶段；只有本机确实缺少该版本及 SHA-256 的引擎时才下载。通过 Tauri Channel 回报已下载字节数、总量和当前阶段，主窗口右下角全局状态卡显示必要状态与进度，切换页面或操作其他功能时下载继续。成功打开店铺后自动隐藏，失败保留实际错误并可关闭；只有正在打开的店铺操作禁用。开发版与正式版使用相同流程，运行时不依赖 Node、Python、clang 或系统 Chrome。

Mac 本机改名、图标和签名属于安装处理，不编译浏览器源码。Mac 只读挂载官方 DMG 并提取应用，设置 `大懒虫浏览器.app` 的独立名称与 Bundle ID，将 `app.icns` 写入原生应用资源，并在主 `Info.plist` 和各语言 `InfoPlist.strings` 中指定该图标、移除 `CFBundleIconName`，然后按由内到外顺序进行本机 ad-hoc 签名；Windows 解压官方 ZIP 为便携目录，将 `app.ico` 写入 `chrome.exe` 的 `IDR_MAINFRAME` 与 `chrome.dll` 的 `101` 原生主图标组及其各语言资源。`<branding>` 为 Bundle ID、显示名、Mac 应用包目录名和本平台 `app.icns`／`app.ico` 共同计算的 SHA-256 前 16 位；图标或应用身份变化时优先复用本机相同上游版本与 SHA-256 的完整引擎，安装到新品牌目录，不重写原目录或运行中的引擎。原有引擎正常关闭后再次打开店铺，才使用新的原生图标。完整引擎安装完成后发布版本目录并继续打开店铺，浏览器程序与 `chromium-profiles/` 账号资料分开。主程序内嵌清单、图标、entitlements 与许可证，上游声明和 `browser-runtime/LICENSE.ungoogled-chromium` 保留。软件打包与发布约束见 [版本发布](RELEASE.md)。

模块与 `chrome_*` IPC 名称保留为现有界面的调用契约。

## 数据与实现

| 位置 | 内容与所有权 |
| --- | --- |
| `assistant-data/workbench.json` | 店铺 UUID、编号、名称、浏览器默认尺寸百分比与最近打开时间 |
| `assistant-data/chromium-profiles/<UUID>/` | 对应店铺的 Chromium 会话、Cookie、标签页、收藏、缓存与扩展存储；`.chrome-debug.json` 记录该店 CDP 端口、PID 与浏览器路径 |
| `assistant-data/browser-runtime/<version>-<sha>-<branding>/` | 由软件按需下载、校验并安装的浏览器程序，开发版与正式版共用同一流程 |
| `browser-runtime/engine.json` | 固定内核版本、平台下载地址、SHA-256 及 Mac 应用身份 |
| `src/features/commerce/workbench.tsx` | 店铺卡片、新建／编辑店铺表单和操作入口；保存结束后后台打开店铺，下载不占用整页操作状态 |
| `src/features/commerce/shop-browser.ts` | 全局 Zustand 店铺打开、浏览器安装进度与错误状态，跨页面保留 |
| `src/features/commerce/browser-install-progress.tsx` | 右下角浏览器下载／安装状态卡；复用任务原生浮层，与邀约状态堆叠并保持在平台网页之上 |
| `src-tauri/src/chrome.rs` | 主界面权限与授权检查、店铺记录和浏览器生命周期、基于真实 profile 持有进程的 loopback CDP 连接与 PID 校验、macOS 进程内 Dock 图标及编号角标；sync_extension_state 唤醒并连接插件后台，在其 worker 会话通过 Extensions.setStorageItems 同步 shopIdentity（number、name） |
| `src-tauri/src/chrome_runtime.rs` | 官方引擎按需下载、SHA-256 校验、Tauri Channel 进度及退出／更新状态检查；独立 `INSTALLATION` mutex 串行安装，下载在 `Chrome.operation` 锁外的 `spawn_blocking` 中执行，完成后重新检查授权和启动条件，再进入店铺生命周期锁打开 |
| `src-tauri/src/chrome_runtime_install.rs` | `chrome_runtime` 的内部 path 子模块；Mac／Windows 提取、原生应用身份和图标设置及 Mac 本机 ad-hoc 签名 |
| `src-tauri/src/chrome_runtime_icon.rs` | Windows `chrome.exe` 的 `IDR_MAINFRAME` 与 `chrome.dll` 的 `101` 主图标组及其各语言资源替换 |
| `src-tauri/src/chrome_process.rs` | macOS profile 的 `SingletonLock` 持有进程识别；通过 `sysctl` 读取真实参数，校验专用浏览器主进程、规范化用户目录与调试端口 |
| `src-tauri/src/chrome_dock.rs` | macOS 原生内存合成小虫 Dock PNG，右上角绘入红底白字店铺编号 |
| `src-tauri/src/browser_extension.rs` | 视频插件程序资源 |
| `browser-extension/shop-label.js`、`shop-label-background.js` | 读取 shopIdentity 显示网页名称标签；既有标签页注入与后续导航加载 |

店铺保留固定 UUID、编号与名称，列表保存在本机。首次使用该店铺的 Chromium 数据目录时，在原网页完成登录；后续复用该目录的会话。通过主窗口关闭按钮、Windows Alt+F4、macOS「退出」菜单、⌘Q 或 Dock「退出」结束软件时，均在程序退出前等待受管理的浏览器正常关闭；安装更新前同样关闭这些浏览器。删除店铺需要明确确认，关闭对应浏览器后删除其本地浏览器数据，保留用户已下载的文件。真实店铺目录和配置不能当作可清理缓存。

浏览器兼容性、登录和视频播放由用户验收；源码实现不代表已完成实际运行验收。

主窗口关闭、退出菜单与快捷键会先异步关闭店铺浏览器；macOS 以真实 profile 持有进程退出作为关闭完成依据，关闭失败时保留主程序并显示错误。屏幕信息在取得浏览器生命周期锁之前读取，避免 macOS Dock 退出等待浏览器操作时相互阻塞。
