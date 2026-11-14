# 浏览器插件独立发行

`browser-extension/` 是可读源码。独立发布只处理 `.work/extension-release/extension/` 副本，不回写源 JS 或 manifest；副本版本取 `package.json.version`，与桌面版本来源一致。

## 产物保护和安装边界

自有 JS 复用现有固定 esbuild 依赖，逐文件压缩空白和局部标识符。保留属性名、文件路径、模块导入、页内注入函数及许可证，不 bundle、不加入 eval、远程加载器或反调试。第三方 vendor 原样保留，不携带 source map、维护文档或私钥。

这是压缩和局部标识符混淆，不是不可逆加密。客户端始终要执行 JavaScript，无法保证不可还原；秘密不应放进扩展。Chrome Web Store 允许常规压缩，不允许隐藏功能的代码混淆，见[代码可读性政策](https://developer.chrome.com/docs/webstore/program-policies/code-readability)。

CRX3 是签名发行文件，不等于跨浏览器安装许可。官方 Chrome 在 Windows/macOS 上限制商店外安装，见[官方分发说明](https://developer.chrome.com/docs/extensions/how-to/distribute)。同时提供 ZIP，解压后可在允许开发者模式的浏览器中加载；不同 Chromium 发行版按其政策安装。ZIP 含签名公钥以固定扩展 ID。GitHub Release 不自动更新已有扩展，不修改桌面浏览器的加载路径或桌面更新。

## 首次配置

需要仓库维护者配置：

- Repository Actions Secret `EXTENSION_SIGNING_KEY`：固定的、未加密 RSA PEM 私钥完整内容。不能使用 Tauri updater 密钥代替。已发行扩展必须沿用原签名密钥，不能每次打包生成新密钥。
- Repository Actions Variable `EXTENSION_ID`：上述公钥对应的 32 字符扩展 ID。打包前从私钥派生公钥和 ID，并与变量精确比较，错配直接失败，避免无意更换安装身份。

不要把密钥贴入 Issue、日志或源码。CI 仅在 runner 临时目录以限制权限写入，打包结束删除该临时副本；上传仅限产物目录。没有密钥时工作流失败并说明缺失项，不自动生成密钥、不发布未签名替代品。首次签名身份由维护者准备和备份。

## 自动打包与发布

1. 将工作流、源码和一致版本提交到 `main`。
2. 推送 `extension-v<package.json.version>` 标签，例如 `extension-v0.3.6`。
3. `Browser Extension Release` 从此精确标签检出，安装锁定依赖、处理副本，并调用 runner 的 Chrome 命令行生成 CRX3。
4. 产物先上传 Actions Artifact，再创建 GitHub 草稿 Release；所有附件上传完成后发布。现有正式 Release 不覆盖，需新版本。失败草稿可重跑补齐。

独立标签不匹配桌面发布的 `v*`，不会触发 Gitee 桌面安装包发布。只授予发布 job `contents: write`；打包 job 只读，不从 PR 事件使用签名密钥。

可在 Actions 手动运行，输入**已经存在的**相同格式标签。默认 `publish=false`，只提供 Actions Artifact；明确选择 `publish=true` 才发布。手动运行不接受任意 source_ref，以免版本标签与构建内容不一致。

产物目录 `dist-release/browser-extension/`：

- `dalanchong-extension-<version>.crx`
- `dalanchong-extension-<version>.zip`（处理后的运行副本，不是可读源码 ZIP）
- `SHA256SUMS`
- `package-info.json`（版本、源提交、公开扩展 ID 和保护方式，无私钥）

GitHub 自动提供的源码归档仍为可读源码，符合“源码不加密”的要求。发布只表示打包与上传成功，不表示真实账号、邀约、视频下载或各浏览器兼容验收完成。

## 本地必要打包

需要 Node 24、安装锁定依赖、`zip`；签名还需 Chrome 命令行。

```sh
pnpm install --frozen-lockfile
# 不接触私钥，只生成处理后 ZIP；没有固定签名 ID。
pnpm package:extension --zip-only
# 用已有的固定签名身份生成 CRX3 和带同一公开身份的 ZIP。
EXTENSION_KEY_PATH=/secure/path/extension.pem \
EXTENSION_ID=维护者配置的扩展ID \
CHROME_PATH=/path/to/chrome \
pnpm package:extension --tag extension-v0.3.6
```

源码内的 README 等维护文档不进入 ZIP，但 `THIRD_PARTY_NOTICES.md`、licenses、LICENSE 与 LEGAL 资源保留。所有生成目录已被 Git 忽略，不能直接修改或提交生成包。
