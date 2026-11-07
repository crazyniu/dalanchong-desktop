# 第三方来源

## 原片探测参考

jiji262/douyin-downloader，核对 revision ed863617aa52353821aca8fdebcfad4e916ebff5。
https://github.com/jiji262/douyin-downloader

原片请求参数与浏览器详情解析由本插件实现。上游 MIT 许可见 licenses/douyin-downloader-MIT.txt。该公开仓库只有抖音 CLI；不包含 README 展示的其他平台桌面版完整实现。

## 分发归属与许可

保留 JoeanAmier / KS-Downloader 的来源归属，revision b8ecf66d46358c013df1637d46d0194a42d525e3，GPL-3.0。
https://github.com/JoeanAmier/KS-Downloader
许可：licenses/KS-Downloader-GPL-3.0.txt。

当前平台实现与范围详见 PLATFORM_SOURCES.md。

## 浏览器内封装

@ffmpeg/ffmpeg 0.12.15，MIT。
@ffmpeg/core 0.12.10，GPL-2.0-or-later，单线程 WASM 内核。
https://github.com/ffmpegwasm/ffmpeg.wasm
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core
https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/build

JavaScript 与 WASM 随插件本地打包；不在运行时从 CDN 下载执行代码。
许可见 licenses/ffmpeg-wasm-MIT.txt 和 licenses/FFmpeg-GPL-2.0.txt。

本分发包包含插件完整 JavaScript、HTML、CSS 源码，按 GNU GPL v3 分发。完整许可见 licenses/KS-Downloader-GPL-3.0.txt。
