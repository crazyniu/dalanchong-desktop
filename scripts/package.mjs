/**
 * AI module map
 * Purpose: build native Tauri distribution artifacts for a selected host/architecture.
 * Entry: package scripts pass platform/arch; RELEASE_BUILD selects signed release handling.
 * Flow: validate target/signing, stage the original video extension, invoke the native build, collect
 * bundles into dist-release/tauri/<platform>/<arch>, and write manifest hashes/signatures.
 * Invariants: do not cross-build on the wrong OS, expose signing secrets, or imply packaging
 * publishes a release. Run only for an explicitly requested build/package/release task.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { prepareVideoExtension } from './prepare-video-extension.mjs'

const root = path.resolve(import.meta.dirname, '..')
const platform = process.argv[2] || process.platform
const arch = process.argv[3] || process.arch
const triples = {
  'darwin/arm64': 'aarch64-apple-darwin',
  'darwin/x64': 'x86_64-apple-darwin',
  'win32/x64': 'x86_64-pc-windows-msvc',
}
const target = triples[`${platform}/${arch}`]
if (!target) throw Error(`不支持的打包目标：${platform}/${arch}`)
if (platform !== process.platform) throw Error('请在目标系统运行原生打包')
const release = process.env.RELEASE_BUILD === 'true'
if (release) {
  const required = ['TAURI_SIGNING_PRIVATE_KEY']
  if (platform === 'darwin')
    required.push(
      'APPLE_SIGNING_IDENTITY',
      'APPLE_API_KEY_PATH',
      'APPLE_API_KEY_ID',
      'APPLE_API_ISSUER'
    )
  for (const key of required)
    if (!process.env[key]) throw Error(`正式发布缺少 ${key}`)
}
const { version } = JSON.parse(
  await readFile(path.join(root, 'package.json'), 'utf8')
)
const env = { ...process.env }
if (!env.TAURI_SIGNING_PRIVATE_KEY)
  env.TAURI_SIGNING_PRIVATE_KEY = path.join(
    root,
    '.local/tauri-signing/updater.key'
  )
const config = {
  bundle: {
    targets: platform === 'darwin' ? ['app', 'dmg'] : ['nsis'],
    resources: await prepareVideoExtension(),
  },
}
const configFile = path.join(root, '.work/tauri-build-config.json')
await mkdir(path.dirname(configFile), { recursive: true })
await writeFile(configFile, JSON.stringify(config))
execFileSync(
  process.execPath,
  [createRequire(import.meta.url).resolve('@tauri-apps/cli/tauri.js'), 'build', '--target', target, '--config', configFile],
  { cwd: root, env, stdio: 'inherit' }
)
const bundle = path.join(root, 'src-tauri/target', target, 'release/bundle')
const output = path.join(root, 'dist-release/tauri', platform, arch)
await mkdir(output, { recursive: true })
const files = (await readdir(bundle, { recursive: true })).filter(
  (name) =>
    name.endsWith('.app.tar.gz') ||
    (name.includes(`_${version}_`) && /\.(dmg|exe)$/.test(name))
)
const assets = []
for (const name of files) {
  const ext = name.endsWith('.app.tar.gz')
    ? 'app.tar.gz'
    : name.split('.').at(-1)
  const renamed = `dalanchong-${version}-${platform}-${arch}.${ext}`
  const file = path.join(bundle, name)
  await copyFile(file, path.join(output, renamed))
  const data = await readFile(file)
  const asset = {
    name: renamed,
    size: data.length,
    sha512: createHash('sha512').update(data).digest('base64'),
  }
  if (ext === 'app.tar.gz' || ext === 'exe') {
    asset.signature = (await readFile(file + '.sig', 'utf8')).trim()
    await copyFile(file + '.sig', path.join(output, renamed + '.sig'))
  }
  assets.push(asset)
}
await writeFile(
  path.join(output, 'updater.json'),
  JSON.stringify(
    {
      version,
      target:
        platform === 'darwin'
          ? `darwin-${arch === 'arm64' ? 'aarch64' : 'x86_64'}`
          : 'windows-x86_64',
      assets,
    },
    null,
    2
  ) + '\n'
)
console.log(`Tauri 安装包：${output}`)
