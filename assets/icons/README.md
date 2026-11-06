# 大懒虫应用图标

- `original.png`：用户提供的小虫原图。
- `white-master.png`：内置图像工具放大与白底处理后的源图；提示词见 `white-master.prompt.txt`。
- `icon-1024.png` / `mac-1024.png`：1024 × 1024 导出母版。
- `app.icns`：macOS 图标，含 16、32、128、256、512 点的 1×/2× PNG。
- `app.ico`：Windows 图标，含 16、20、24、32、40、48、64、96、128、256 像素的 32 位图像。
- `icon-*.png`：各尺寸 PNG；`app.iconset/`：ICNS 输入文件。
- `tauri/256x256.png`：Tauri 使用的 256 × 256 RGBA 图标。

在 macOS 执行 `pnpm icons:build`，使用系统 `sips` 和 `iconutil` 导出，再同步到桌面端 `public/brand.png` 与 `public/favicon.png`。通用激活码后台继续使用钥匙图标。

侧栏使用 `public/brand-transparent.png`，直接复制透明底 `original.png`，保留原图透明通道。

`src-tauri/tauri.conf.json` 配置 PNG、ICNS 和 ICO，供窗口与安装包使用。打包命令为 `pnpm package:mac` 和 `pnpm package:win`（Windows x64）。

尺寸参考：[Apple App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[Microsoft App Icon Construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)。
