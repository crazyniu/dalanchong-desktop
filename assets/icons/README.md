# 大懒虫应用图标

- `original.png`：用户提供的小虫原图。
- `white-master.png`：内置图像工具放大与白底处理后的源图；提示词见 `white-master.prompt.txt`。
- `icon-1024.png` / `mac-1024.png`：1024 × 1024 导出母版。
- `app.icns`：macOS 图标，含 16、32、128、256、512 点的 1×/2× PNG。
- `app.ico`：Windows 图标，含 16、20、24、32、40、48、64、96、128、256 像素的 32 位图像。
- `icon-*.png`：各尺寸 PNG；`app.iconset/`：ICNS 输入文件。
- `tauri/256x256.png`：Tauri 使用的 256 × 256 RGBA 图标。

需要重新导出图标时，在桌面端仓库目录、macOS 环境执行 `pnpm icons:build`。脚本使用系统 `sips`、`iconutil` 和 Tauri 图标命令，更新各尺寸资源及 `public/brand.png`、`public/brand-transparent.png`、`public/favicon.png`。普通代码或文档修改不运行图标导出。通用激活码后台继续使用钥匙图标。

侧栏使用 `public/brand-transparent.png`，直接复制透明底 `original.png`，保留原图透明通道。

`src-tauri/tauri.conf.json` 配置 PNG、ICNS 和 ICO，供窗口与安装包使用。打包命令为 `pnpm package:mac` 和 `pnpm package:win`（Windows x64）。

这些图标原图与已导出文件均随源码保留，是界面和安装包的输入，不按 `dist/` 等构建缓存忽略或清理。打包、签名和交付目录见 [发布说明](../../docs/RELEASE.md)。

尺寸参考：[Apple App Icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)、[Microsoft App Icon Construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)。
