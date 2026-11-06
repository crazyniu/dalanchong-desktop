# 开发约定

- 禁止防御性编程、过度测试。UI 只保留必要说明，不加宣传文案和无用小字。
- 先读 `README.md`、`docs/ACTIVATION.md`；界面沿用 `DESIGN.md` 和现有 Shadcn 组件。
- 仅登录、激活、新建等表单标题居中；页面标题、侧栏和信息布局不要全局居中。桌面名称为「大懒虫」，图标为白底绿色小虫；通用后台仍叫「激活码管理」。
- 侧栏固定展开，不加折叠按钮或快捷键。激活前显示可复制设备码；激活后授权窗口只显示到期时间和设备码，不放激活码输入框。
- 本项目为 Electron「大懒虫」。不要顺手改 `../extension` 或授权后台的数据库规则。
- 本目录就是独立仓库根目录：`https://github.com/crazyniu/dalanchong-desktop`。发布包与 Release 说明位于 Gitee 公有仓库 `https://gitee.com/zhenxiaoguo/dalanchong`；不要把上级项目目录、用户数据或本机凭据提交上库。
- 保留现有未提交修改。真实账号、Cookie、运行记录位于 `../.local/ecommerce-assistant`，不要删除或用于自动测试。
- 授权固定 `app_id = dalanchong`。主进程负责安装 ID、加密保存激活码和联网校验；渲染进程只负责交互，不可绕过主进程授权。
- 不提供离线授权或测试后门。失败校验不得自动调用激活接口；换机保持服务端原到期时间。
- 新增受限 IPC 沿用 `handle()` 默认授权校验；任务的实际平台请求也必须经过授权检查。停止任务始终可用。
- 不把管理员密码、Supabase secret/service_role key 放入桌面端。软件端公共接口不需要这些密钥。
- 测试使用 `ASSISTANT_TEST_DATA` 指向隔离目录；不真实发送邀约。改授权时跑 `pnpm test:license`、`pnpm lint`、`pnpm build`；改任务逻辑再跑 `pnpm test:core`。

## 版本与发布

- 发布前先读 `docs/RELEASE.md`。`package.json.version` 是唯一版本来源；侧栏编译版本、主进程版本、Git tag `v<version>`、`release-notes/<version>.md` 必须一致，使用发布检查脚本校验。
- 只有用户要求发布时才推版本 tag 或触发 Release 工作流；普通代码修改不自动打包、发布或更新用户软件。
- 更新说明从 Gitee Release 读取，发布时同步 GitHub Release 正文。先上传所有安装包，再更新对应系统/架构的 latest 元数据；不得发布指向未上传附件的更新。
- GitHub Actions Secrets 保存 Gitee 令牌、签名和公证凭据；不得写入代码、客户端配置或日志。PR CI 不运行云端授权验收或发布。
- 更新只检查，不自动下载或安装。安装前检查运行任务并保存账号、Cookie 和记录；保持原 `appId` 与用户数据路径，不能清空数据或绕过授权。
- 修改更新逻辑跑 `pnpm test:update`、`pnpm lint`、`pnpm build`。使用模拟下载器与隔离目录；不得对用户正在运行的软件执行升级。

## 入口

- `electron/main.mjs`：窗口、IPC、会话、授权拦截。
- `electron/license.mjs`：授权接口和本机加密存储。
- `electron/runner.mjs`：采集、邀约任务。
- `src/features/commerce/license.tsx`：激活页、授权状态。
- `src/features/commerce/store.ts`：界面业务状态。
