# 视频来源

## 作品解析

原片请求参数参考 [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader)，核对 revision `ed863617aa52353821aca8fdebcfad4e916ebff5`。浏览器详情解析和请求由本插件实现，来源归属及 MIT 许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `licenses/douyin-downloader-MIT.txt`。

`page.js` 按指定作品 ID 读取视频详情；抖音详情页与搜索结果的视频弹层均提供下载按钮，当前作品按 URL 的 `modal_id`、`vid`、`/video/<ID>` 顺序识别，弹层切换作品后清除旧显示，在悬停、键盘聚焦对应按钮或下载时读取信息，并在下载前复核身份；`resolve.js` 提取抖音作品 ID，并通过 HTTP 重定向展开分享短链接；`background.js` 在已有抖音网页的 MAIN 环境中复用详情请求与原片地址探测，调度详情页下载及批量解析。批量优先原片，探测失败后从该作品详情返回的完整视频中选择最高可用清晰度，并保留真实画质；详情页原片按钮仍使用原片探测结果。批量请求不导航或切换来源网页，原片探测按标签页串行，批量进度与当前详情页状态分别保存。作品地址来自平台详情，「原片」不保证等同于作者上传的文件。

抖音原画以详情返回的真实 `video_id`，携带 `ratio=default` 与 `source=PackSourceEnum_PUBLISH` 请求 `/aweme/v1/play/` 平台调度。CDN 连接失败、超时或返回 HTTP 403／404／410／5xx 时，重新请求平台调度响应，合计最多 3 次；调度请求使用 `Cache-Control: no-cache`，CDN 检查使用 `cache: no-store`。节点仅取平台响应，不硬编码或替换 CDN，也不切换画质；重复调度仍可能返回同一节点。

媒体检查使用无凭据 Range 请求，跟踪完整重定向链并在最终响应处确认完整视频；通用二进制类型通过 MP4 文件头检查。Console 显示每次节点获取结果，诊断保留各次 302 等重定向的域名、HTTP 状态和 Chrome 网络错误码，不记录签名 URL 查询参数。只有验证成功后才将最终视频地址及媒体确认状态保存到视频列表。

## 电商页面

罗盘、百应适配范围以 `manifest.json` 的页面匹配和 `xhr.js` 的接口处理为准。视频条目取自当前登录账号的实际响应，关联视频按所属商品、达人或作品展示；封面与作者抖音号不作为视频地址或作品 ID。界面与消息模块见 [电商页面](COMMERCE.md)。

插件仅将支持页面内的有效视频资源纳入媒体列表。图片、音频、接口响应和媒体分段不作为完整视频下载；来源和许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 快手详情页

详情页从当前作品响应的 `manifest.adaptationSet` 或 `videoResource.json.h264.adaptationSet` 读取视频格式，结构参考 [videodl 快手实现](https://github.com/CharlesPikachu/videodl/blob/master/videodl/modules/sources/kuaishou.py)。原画优先平台原画标记，否则使用接口提供的最高分辨率、同尺寸最高码率格式；当前清晰度按播放器当前档位匹配作品接口提供的完整 MP4。
