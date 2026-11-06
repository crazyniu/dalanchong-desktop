# 激活码接入

## 使用

1. 在 `license-admin` 后台选择「大懒虫」，软件标识必须是 `dalanchong`。
2. 创建所需时长的激活码，复制给用户。
3. 启动桌面端，输入激活码并点击「激活」。点击侧栏底部右侧到期日期或「永久有效」查看激活信息，只显示到期时间与设备码，不再提供激活码输入。
4. 换电脑时先在后台对该码执行「解绑换机」，再在新电脑激活。首次激活时间和原到期时间保留。

断网不能激活或使用受限功能，恢复联网后点击「重新验证」。后台解绑后不会自动重绑，需手动输入激活码激活。软件没有管理员登录入口，不需要管理员账号密码。

## 固定配置

- 软件：大懒虫
- `app_id`：`dalanchong`，沿用后台已有记录，不得改成包名。
- 接口：`https://lfrgswefkgdzhureqzod.supabase.co/functions/v1/license-api`
- `POST /activate`、`POST /verify` 请求体：`{ app_id, code, device_id }`。
- 公共接口不需要 Supabase 管理员凭据或服务端密钥；详细协议见 [授权接口文档](https://github.com/crazyniu/license-admin/blob/main/docs/API.md)。

## 运行流程

`LicenseGate` 启动时请求 `verifyLicense()`，成功后才载入业务数据与页面。未激活、过期、设备被禁用、设备不符或联网失败时显示激活页。

Rust command 对 main 来源进行校验，开始任务、平台请求前调用 `/verify`。platform_eval 在每次平台请求前再次校验，覆盖长时间采集与邀约任务；停止任务不受授权限制。校验失败抛出 `beforeSend` 错误，任务停止，不把尚未发出的邀请标记成已发送或待核实。在途平台请求可能已完成，沿用任务原有结果处理。

闲置时不轮询；过期或后台解绑在下一次业务操作或任务请求前生效。退出重启只校验，不重新激活或续期。校验失败不会自动调用 `/activate`。

激活码只在成功激活后保存。输错替换码保留旧码。设备码为 Rust 原生端提供的持久化安装 ID；断网也能查看和复制。授权时间取服务端返回值，界面按本地时区显示，永久授权的 `expires_at` 为 `null`。

## 本机数据

`<应用数据目录>/assistant-data/license-tauri.json` 只保存安装 UUID；激活码保存在系统凭据存储（macOS Keychain / Windows Credential Manager），不保存可作为离线授权依据的成功状态。首次迁移只读取旧 license.json 的 deviceId，保留旧文件和设备绑定，用户重新输入原码。前端无法取得明文凭据。

`sh ./run.sh` 默认使用 `../.local/ecommerce-assistant`，与已有账号数据共用同一目录。单独 `pnpm desktop` 沿用 `<appData>/电商助手` 目录（旧名称用于保持数据兼容）；两种方式的安装 ID 不同，请日常统一用 `run.sh`。清空目录或换数据目录会成为新设备。安装 ID 是本机持久化标识，不是硬件指纹；不要把用户数据目录复制给其他人。

浏览器 `pnpm dev` 使用演示模式，不调用真实平台或授权接口。Tauri 开发和生产构建均启用授权，不能用环境变量跳过。

## 检查

```sh
pnpm test:native
pnpm lint
pnpm build
# 使用全新隔离目录检查真实桌面界面
ASSISTANT_TEST_DATA="$(mktemp -d /tmp/assistant-license.XXXXXX)" pnpm desktop
```

真实联调使用临时测试码与隔离数据目录，检查安装 ID、系统凭据保存、重启校验、错误换码保留原码，以及断网、过期、解绑、异设备和禁用设备时的拒绝行为。完成后仅删除该测试码，不触碰用户已有激活码或真实账号数据。
