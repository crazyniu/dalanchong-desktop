# 大懒虫

基于 Shadcn Admin、React、shadcn/ui 和 Electron 的中文桌面工具。

本目录为独立仓库根目录：[GitHub 源码](https://github.com/crazyniu/dalanchong-desktop)，[Gitee Releases](https://gitee.com/zhenxiaoguo/dalanchong/releases)。授权后台是独立的 [license-admin 仓库](https://github.com/crazyniu/license-admin)。

## 在线更新

侧栏底部显示当前版本和「检查更新」。启动时检查 Gitee Release，发现新版后显示 Release 说明；点击下载后显示进度，下载并校验成功后可重启安装。存在采集或邀约任务时先停止任务，安装前保存账号与记录。

`run.sh` 源码模式可以检查版本，下载安装由正式安装版提供；第一次安装需要使用发布的 DMG/NSIS 安装包。打包、Gitee 发布、GitHub Actions Secrets 和版本检查见 [发布说明](docs/RELEASE.md)。

## 运行

一键启动桌面端：

```sh
sh ./run.sh
```

脚本自动安装项目依赖、构建最新界面并启动 Electron，无需打包或先开 Web 服务。需要本机已有 Node.js 和 pnpm。现有账号、Cookie 与采集记录已迁移至项目根目录的 `.local/ecommerce-assistant/`，启动脚本使用该目录；可通过 `ASSISTANT_TEST_DATA` 指定其他数据目录。也可在项目根目录运行 `sh ./run.sh`。

只预览 Web 界面：

```sh
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5173 查看可点击 Web 原型。浏览器内使用演示账号和演示数据，点击「开始邀约」仅模拟任务，不发送真实邀约。

```sh
pnpm build
pnpm desktop
```

Electron 版先输入激活码，再使用真实平台网页与独立账号会话，首次启动没有演示账号。在「平台账号」添加账号后，直接在内置网页登录。

开发桌面界面时，保持 `pnpm dev` 运行，另开终端执行 `pnpm desktop:dev`。

## 激活

在激活码后台选择「大懒虫」（`app_id: dalanchong`）创建激活码，输入桌面端即可。激活页面显示可复制的设备码；激活后左下角授权入口只显示到期时间和设备码。换机先在后台解绑，原到期时间不变。

启动、业务操作和任务请求前联网校验，断网、过期或设备不符时不可继续。管理员账号只用于激活码后台，不用于桌面端。

使用与接入细节见 [激活说明](docs/ACTIVATION.md)，AI 开发约定见 [AGENTS.md](AGENTS.md)。

## 功能

- 数据概览：平台、账号、日期筛选，采集与邀约统计、趋势、结果分布、账号剩余额度、CSV 导出。
- 快手邀约：同行合作参考原网页，沿用网页生效的搜索和筛选条件采集合作达人、跨页去重，保存到采集列表。
- 抖音邀约：达人广场原网页，沿用网页筛选采集达人并保存；邀约所选达人时检查权限、商品可带范围，再发送首次邀约卡片。
- 采集列表：按平台保存、搜索、勾选、导出；可用同平台其他账号邀约已采集的达人。
- 错误日志：只记录异常，保留账号、步骤、接口、HTTP 状态、业务码、请求 ID 和脱敏响应正文；邀约页及平台账号可查看、展开详情、导出。采集异常还会在网页右下方显示半透明浮层，可收起。
- 邀约设置：点击「邀约所选」后选择发送账号，填写商品 ID、话术、联系方式、间隔与上限。记录支持筛选、详情、导出和人工核实。
- 平台账号：添加、切换、打开、重新登录和移除。两平台的账号、配置和任务分别保存。

先在原网页完成筛选并点击「开始采集」，采集结果逐批保存；采集结束或停止都不会发送邀约。打开「采集列表」勾选达人，点击「邀约所选」，选择发送账号并登录，填写配置后明确点击「开始邀约」。

采集列表按平台共享并保留采集账号，去重和发送记录按邀约账号处理。任务复制启动时的筛选、所选达人或配置并绑定账号；切换页面或账号不会改变运行中的任务。关闭软件停止任务，重启保留采集列表、进度和历史，不自动重发。

## 登录数据

每个账号使用 `persist:<平台>:<账号 ID>` 的 Electron Session。Cookie、Local Storage 等网站数据由对应会话保存；额外用 Electron safeStorage 加密保存 Cookie 快照，使没有到期时间的会话 Cookie 也可恢复。界面不暴露 Cookie，也不需要手工复制。

平台接口确认登录有效后显示「已登录」。失效时打开对应账号重新登录。移除账号清除对应网站会话和 Cookie 快照，历史记录保留。

旧 Cookie 快照无法解密时保留为 `.cookies.unreadable-时间戳`，继续打开该账号的持久网页会话；网站登录已失效时可直接重新登录。恢复失败原因写入错误日志。网页加载并完成账号绑定前，采集和邀约按钮保持不可用。

采集列表、任务与记录位于系统应用数据目录中的 `assistant-data/runtime.json`，加密 Cookie 快照位于同目录。测试使用隔离目录，不包含真实账号数据。

## 当前平台适配范围

快手适配「同行合作参考」店铺列表及合作达人接口，采集范围以平台实际返回的合作达人为准；沿用原插件昵称含「鼠」排除规则和近 7 天成功邀约去重规则。联系方式可使用填写值，快手后台还需有完整邀约联系人。

抖音适配普通首次邀约卡片，最多 5 个商品、150 字话术；保留平台返回的商品佣金设置。可直接沟通、强模板或当前不可邀约的达人会跳过。设备信息由平台自身页面模块取得，平台后续更新可能需要同步适配。

发送前先保存「发送中」记录；请求结果不明确时记为「待核实」并停止，不自动重试。确认平台结果后可在记录详情人工核实。

错误日志独立保存在 `<Electron userData>/assistant-data/errors.ndjson`，不会被下一次任务覆盖；日常使用 `run.sh` 时位于项目根目录 `.local/ecommerce-assistant/assistant-data/errors.ndjson`。界面展示最近 1000 条，导出保留全部错误历史。正常进度、成功、跳过及手动停止不写日志。响应正文最多保留 8000 字并隐藏敏感字段，不记录请求 Cookie、联系方式或激活码。授权失效时仍可从应用菜单「显示 → 导出错误日志」导出。

## 检查与打包

```sh
pnpm lint
pnpm build
pnpm test:core
pnpm test:license
pnpm test:update
pnpm test:scripts
pnpm package:mac
pnpm package:win
```

Electron Builder 将产物输出至 `dist-release/<platform>/<arch>/`。Mac 提供 DMG 与 ZIP，Windows 提供 x64 NSIS EXE；`pnpm package:mac` 使用本机架构。默认本地包无签名，正式 Mac 发布必须签名并公证。

图标及导出方法见 [应用图标](assets/icons/README.md)：白底小虫、Mac ICNS、Windows 多尺寸 ICO，已接入窗口、Dock、网页和打包配置。通用激活码后台继续使用自己的名称和钥匙图标。

main / PR 的 CI 只运行检查与 Web 构建，不自动生成原生安装包。原生打包在手动发布工作流或版本 tag 工作流中执行，流程及所需 Secrets 见 [发布说明](docs/RELEASE.md)。

已检查 1440×900、1280×800 下的页面布局与核心交互；已验证桌面启动、真实网页容器、同平台会话 Cookie 隔离、持久 Cookie 与会话 Cookie 的重启恢复。核心测试使用模拟接口，不发送消息。

真实商家账号登录、登录失效后恢复以及真实邀约发送仍需账号联调；Cookie 存储测试不等于平台登录有效性验收。

## 来源

- [Shadcn Admin](https://github.com/satnaing/shadcn-admin)，保留 MIT LICENSE。
- [shadcn/ui MCP](https://ui.shadcn.com/docs/registry/mcp)：通过官方 MCP 查询组件示例和添加命令，使用现成 Sidebar、Card、Table、Dialog、Sheet、Tabs、Chart、Progress 等组件。
- [Electron 持久会话](https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options)。
