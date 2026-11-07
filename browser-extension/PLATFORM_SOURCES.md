# 抖音视频来源

## 作品解析

原片请求参数参考 [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader)，核对 revision `ed863617aa52353821aca8fdebcfad4e916ebff5`。浏览器详情解析和请求由本插件实现，来源归属及 MIT 许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `licenses/douyin-downloader-MIT.txt`。

`page.js` 读取当前作品的视频详情；`resolve.js` 处理抖音作品及分享链接；`background.js` 调度高清与原片地址。作品地址来自平台详情，「原片」不保证等同于作者上传的文件。

媒体检查沿用源插件的无凭据 Range 请求，允许详情中的抖音播放地址跳转，在最终响应处确认 CDN 域名及视频类型。成功结果携带媒体确认状态供视频列表使用。

## 电商页面

罗盘、百应适配范围以 `manifest.json` 的页面匹配和 `xhr.js` 的接口处理为准。视频条目取自当前登录账号的实际响应，关联视频按所属商品、达人或作品展示；封面与作者抖音号不作为视频地址或作品 ID。界面与消息模块见 [电商页面](COMMERCE.md)。

插件仅将支持页面内的有效视频资源纳入媒体列表。图片、音频、接口响应和媒体分段不作为完整视频下载；下载和封装依赖的许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
