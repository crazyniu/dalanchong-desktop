# 多店铺

侧栏「多店铺」管理使用本机 Chrome 的独立店铺，使用已正常安装的 Google Chrome Stable。每次新建一个店铺并设置名称；UUID、编号、登录会话、收藏、标签页和插件数据独立保存。首次打开空白页，重复打开切回原窗口，冷启动恢复上次会话。

## 店铺与操作

- Chrome 使用本机正常安装位置，并由 Chrome 自身更新版本；macOS 查找 `/Applications` 和用户 `~/Applications`，Windows 查找用户及系统的标准 Chrome 安装目录。未安装时引导至 [Google 中国官方下载页](https://www.google.cn/chrome/)。
- 网页使用 Chrome 原生 UA、语言、时区、屏幕、硬件、网络与音视频能力。视频播放使用该 Chrome 安装本身提供的解码器。
- 右上角提供「新建店铺」，卡片提供打开、编辑名称与删除店铺操作，显示最近打开时间；名称可在浏览器运行时修改。
- 各店铺使用独立的浏览器数据目录，与达人邀约的 WebView 账号分别保存会话。
- 标签页、地址栏、下载与收藏由 Chrome 原生界面负责。默认平台书签只初始化一次，保留用户后续编辑。
- 视频功能由自动加载的 Chrome 插件提供，右上角固定图标和「视频下载」书签打开插件入口，加载和资源说明见 [视频插件来源](VIDEO_SOURCES.md)。

## 数据与实现

| 位置 | 内容与所有权 |
| --- | --- |
| `assistant-data/workbench.json` | 店铺 UUID、编号、名称与最近打开时间 |
| `assistant-data/chrome-profiles/<UUID>/` | 对应店铺的 Chrome 会话、Cookie、标签页、收藏、缓存与扩展存储 |
| `src/features/commerce/workbench.tsx` | 店铺卡片、新建／编辑店铺表单和操作入口 |
| `src-tauri/src/chrome.rs` | 主界面权限与授权检查、店铺记录和浏览器生命周期 |
| `src-tauri/src/chrome_runtime.rs` | 查找系统 Chrome 与启动状态限制 |
| `src-tauri/src/browser_extension.rs` | 视频插件程序资源 |

店铺保留固定 UUID、编号与名称，列表保存在本机。首次使用该店铺的 Chrome 数据目录时，在原网页完成登录；后续复用该目录的会话。关闭软件或安装更新时正常关闭受管理的浏览器。删除店铺需要明确确认，关闭对应浏览器后删除其本地浏览器数据，保留用户已下载的文件。真实店铺目录和配置不能当作可清理缓存。

浏览器兼容性、登录和视频播放由用户验收；源码实现不代表已完成实际运行验收。
