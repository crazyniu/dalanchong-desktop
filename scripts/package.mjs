import { build, Platform, Arch } from 'electron-builder'
import { rm } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const platform = process.argv[2] || process.platform
const arch = process.argv[3] || (platform === 'win32' ? 'x64' : process.arch)
if (
  !['darwin/arm64', 'darwin/x64', 'win32/x64'].includes(`${platform}/${arch}`)
)
  throw Error(`不支持的打包目标：${platform}/${arch}`)
const release = process.env.RELEASE_BUILD === 'true'
if (release && platform === 'darwin') {
  for (const key of [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    'APPLE_API_KEY',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ])
    if (!process.env[key])
      throw Error(`Mac 正式发布必须签名并公证，缺少 ${key}`)
}
process.env.UPDATE_PLATFORM = platform
if (!release) process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
const target = platform === 'darwin' ? Platform.MAC : Platform.WINDOWS
const output = path.join(root, 'dist-release', platform, arch)
await rm(output, { recursive: true, force: true })
await build({
  projectDir: root,
  targets: target.createTarget(
    platform === 'darwin' ? ['dmg', 'zip'] : ['nsis'],
    Arch[arch]
  ),
  publish: 'never',
  config: {
    extends: path.join(root, 'electron-builder.yml'),
    directories: { output },
    forceCodeSigning: release && platform === 'darwin',
    ...(platform === 'darwin' && !release
      ? { mac: { identity: null, notarize: false } }
      : {}),
  },
})
