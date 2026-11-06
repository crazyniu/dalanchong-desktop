# 开发约定

- 禁止防御性编程、过度测试。UI 只保留必要说明，不加宣传文案和无用小字。
- 测试与验收由用户负责。除非用户明确要求，不主动编写或运行测试，也不主动执行用于验证的 lint、构建、界面自动化、截图验收或临时验证程序。修改完成后直接交付，用户发现问题会反馈，再按反馈修复。明确要求构建、打包或发布时，只执行该任务必需步骤，不追加测试。
- 先读 `README.md`、`docs/ACTIVATION.md`；界面沿用 `DESIGN.md` 和现有 Shadcn 组件。
- 仅登录、激活、新建等表单标题居中；页面标题、侧栏和信息布局不要全局居中。桌面名称为「大懒虫」，图标为白底绿色小虫；通用后台仍叫「激活码管理」。
- 侧栏固定展开，不加折叠按钮或快捷键。激活前显示可复制设备码；激活后授权窗口只显示到期时间和设备码，不放激活码输入框。
- 本项目为 Tauri 2「大懒虫」，禁止重新引入 Electron 或打包 Node/Chromium。不要顺手改 `../extension` 或授权后台的数据库规则。
- 本目录就是独立仓库根目录：`https://github.com/crazyniu/dalanchong-desktop`。发布包与 Release 说明位于 Gitee 公有仓库 `https://gitee.com/zhenxiaoguo/dalanchong`；不要把上级项目目录、用户数据或本机凭据提交上库。
- 保留现有未提交修改。真实账号、Cookie、运行记录位于 `../.local/ecommerce-assistant`，不要删除或用于自动测试。
- 授权固定 `app_id = dalanchong`。Rust 原生端负责安装 ID、本地缓存激活码和联网校验；前端只负责交互，不可绕过Rust 原生端授权。
- 不提供离线授权或测试后门。失败校验不得自动调用激活接口；换机保持服务端原到期时间。
- 新增受限 command 必须检查 main WebView 来源并执行 `license::require_valid`；任务的实际平台请求也必须经过授权检查。停止任务始终可用。
- 不把管理员密码、Supabase secret/service_role key 放入桌面端。软件端公共接口不需要这些密钥。
- 仅在用户明确要求协助测试时，使用 `ASSISTANT_TEST_DATA` 指向隔离目录，不真实发送邀约；按用户指定范围执行，不自动扩大测试范围。

## 版本与发布

- 发布前先读 `docs/RELEASE.md`。`package.json.version` 是唯一版本来源；侧栏编译版本、Rust 原生端版本、Git tag `v<version>`、`release-notes/<version>.md` 必须一致，使用发布检查脚本校验。
- 只有用户要求发布时才推版本 tag 或触发 Release 工作流；普通代码修改不自动打包、发布或更新用户软件。
- 更新说明从 Gitee Release 读取，发布时同步 GitHub Release 正文。先上传所有安装包，再更新对应系统/架构的 latest 元数据；不得发布指向未上传附件的更新。
- 每个版本必须根据上个发布版本以来实际完成的变更编写 `release-notes/<version>.md`，正文使用中文，固定包含「新增功能」和「问题修复」两部分；没有对应变更时写「本版无新增功能」或「本版无问题修复」，不编造、不直接粘贴英文提交日志。
- Release 标题使用「大懒虫 <version>」，GitHub、Gitee 和升级弹窗共用该版本同一份中文更新说明；升级弹窗渲染标题与列表，不显示 Markdown 标记或改成另一套简介。
- 用户明确要求打包测试时，只记录实际执行项目的结果；模拟接口验证不能写成线上升级成功。测试包不自动发布，也不升级用户正在使用的实例。
- GitHub Actions Secrets 保存 Gitee 令牌、签名和公证凭据；不得写入代码、客户端配置或日志。PR CI 不运行云端授权验收或发布。
- 更新只检查，不自动下载或安装。安装前检查运行任务并保存账号、Cookie 和记录；保持原 `appId` 与用户数据路径，不能清空数据或绕过授权。
- 修改更新逻辑后交由用户测试；只有用户明确要求协助测试时才使用模拟下载器与隔离目录。不得对用户正在运行的软件执行升级。

## 入口

- `src-tauri/src/lib.rs`、`browser.rs`：窗口、commands、账号 WebView、授权拦截。
- `src-tauri/src/license.rs`：授权接口及本地缓存。
- `src/desktop-runtime/`：采集、邀约任务；平台请求经 Rust 授权后在平台网页执行。
- `src/features/commerce/license.tsx`：激活页、授权状态。
- `src/features/commerce/store.ts`：界面业务状态。

## Tauri 迁移约束

- macOS 14+ 使用每账号独立 WKWebsiteDataStore，Windows 使用每账号数据目录。测试 UUID 必须含 ASSISTANT_TEST_DATA 路径，不得碰真实账号存储。
- 旧 Electron 用户数据和历史安装包保留（旧运行源码已移除）；新原生授权沿用原 deviceId。激活码和 Cookie 快照使用应用本地缓存，不访问钥匙串；macOS 文件权限为 0600。旧钥匙串和加密快照保留但不读取，不伪造 Cookie 已迁移；激活码需重新输入一次，登录失效时重新登录。
- 远程 WebView 只允许 platform_result / platform_observe；不能调用本地数据、授权或更新命令。主 UI 禁止导航到远程网站。
- updater 私钥只放 .local/tauri-signing 或 CI Secret，不提交；公钥固定到 tauri.conf.json。Tauri 更新使用 updates/tauri/latest.json，不覆盖旧 Electron 元数据。
- 多账号、登录持久化、页内执行和更新必须区分隔离验证与线上验证。不能把编译成功写成真实平台采集/邀约已验收。
