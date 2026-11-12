# 大懒虫应用图标

- `original.png`：用户提供的小虫原图；侧栏继续使用 `public/brand-transparent.png` 中的透明底原图。
- `white-master.png`：白底小虫源图，提示词见 `white-master.prompt.txt`，用于机械导出平台图标。
- `mac-1024.png`：Mac 的 1024 × 1024 RGBA 母版；`app.iconset/` 与 `app.icns` 均来自此母版。
- `icon-1024.png`：Windows 的 1024 × 1024 RGBA 母版；`icon-*.png`、`app.ico`、`tauri/256x256.png` 均来自此母版。
- `app.icns`：Mac 图标，含 16、32、128、256、512 点的 1×／2× PNG。
- `app.ico` 与 `icon-*.png`：Windows 的 15 档 32 位 RGBA 图像，尺寸为 16、20、24、30、32、36、40、48、60、64、72、80、96、128、256 像素。

两端使用白底圆角小虫图形，画布外沿透明。1024 像素母版的几何参数：

| 平台 | 透明外边距 | 图形尺寸 | 圆角半径 |
| --- | --- | --- | --- |
| Mac | 96 px | 832 × 832 px | 185 px |
| Windows | 64 px | 896 × 896 px | 192 px |

重新导出时，在桌面端仓库目录、macOS 环境执行 `pnpm icons:build`。`scripts/build-icons.mjs` 调用 `scripts/render-native-icons.swift`，由 Swift AppKit 在内存画布渲染两端母版，再用系统 `sips` 缩放、`iconutil` 生成 ICNS，由 Node 写入多尺寸 ICO 和 Windows Tauri PNG。该命令仅生成平台图标，不调用 Tauri 图标命令或应用构建，也不更新 `public/brand.png`、`public/brand-transparent.png`、`public/favicon.png`。普通代码或文档修改不运行图标导出。

通用 `src-tauri/tauri.conf.json` 保留 Windows PNG／ICO 图标路径；Mac 自动合并 `src-tauri/tauri.macos.conf.json`，使用 `app.iconset/icon_256x256.png` 与 `app.icns`。Mac 开发版 Dock 在 ICNS 存在时优先使用 ICNS，PNG 用于后备／默认窗口图标。主程序内部可执行文件名和 Cargo 包名保留 ASCII `dalanchong`，库名为 `dalanchong_lib`；`src-tauri/Info.plist` 的 `CFBundleDisplayName`／`CFBundleName` 提供中文「大懒虫」。Mac 开发版由 Cargo runner 复制主目标到 `.work/dev-app/大懒虫.app/Contents/MacOS/dalanchong`，写入完整应用身份、版本与图标并本机 ad-hoc 签名，再以 `process.execve` 执行；正式包通过 `macOS.infoPlist` 合并元数据。打包入口仍为 `pnpm package:mac` 和 `pnpm package:win`。

店铺浏览器安装时直接设置原生应用图标：Mac 将 `app.icns` 写入 `大懒虫浏览器.app`，主 `Info.plist` 与各语言 `InfoPlist.strings` 指向该图标并移除 `CFBundleIconName`，随后重新进行本机 ad-hoc 签名；Windows 由 `src-tauri/src/chrome_runtime_icon.rs` 将 `app.ico` 写入 `chrome.exe` 的 `IDR_MAINFRAME` 与 `chrome.dll` 的 `101` 原生主图标组及其各语言资源。

运行时安装目录的 `<branding>` 为 Bundle ID、显示名、Mac 应用包目录名和本平台 ICNS／ICO 共同计算的 SHA-256 前 16 位。图标或应用身份变化后，复制本机相同上游版本与 SHA-256 的完整引擎并应用当前品牌到新目录，原目录与运行中引擎保持原样；原有引擎正常关闭后重新打开店铺生效。

Mac 店铺专用 Chromium 的运行时 Dock 图标取 `app.iconset/icon_512x512.png`，由 `chrome_dock.rs` 以 `NSImage` 读取，在新建的 512 × 512 预乘 RGBA 画布中清透明底、绘制源图及红底白字店铺编号，编码后通过 CDP 设置。

这些源图与导出文件均随源码保留，是界面和安装包输入，不按构建缓存忽略或清理。图标导出不代表应用构建或平台显示验收；打包、签名和交付目录见 [发布说明](../../docs/RELEASE.md)。通用激活码后台继续使用钥匙图标。

尺寸参考：[Apple App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[Microsoft App Icon Construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)。
