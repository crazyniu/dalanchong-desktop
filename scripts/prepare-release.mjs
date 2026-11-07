/**
 * AI module map
 * Purpose: validate release inputs and assemble metadata without publishing them.
 * Entry: readRelease, inspectArtifacts, prepareRelease, and CLI argument handling.
 * Flow: compare package/Cargo/tag versions and Chinese release-note sections, inspect all
 * required target artifacts and size/hash/signature metadata, then prepare publication data.
 * Invariants: package.json is the version source; assets must exist and match their
 * manifests before any latest pointer can be produced. Imported helpers are also used by
 * publish-release.mjs and existing script tests; do not run checks without user authorization.
 */

import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const TARGETS = ['darwin/arm64', 'darwin/x64', 'win32/x64']
export const MAX_ASSET_SIZE = 100 * 1024 * 1024
export function validateTag(version, tag) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || tag !== `v${version}`)
    throw Error(`发布 tag 必须与 package.json 一致：v${version}，收到 ${tag}`)
}
export async function readRelease(tag, root = ROOT) {
  const pkg = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  )
  validateTag(pkg.version, tag)
  const cargo = await readFile(path.join(root, 'src-tauri/Cargo.toml'), 'utf8')
  if (cargo.match(/^version = "([^"]+)"/m)?.[1] !== pkg.version)
    throw Error('Cargo 版本必须与 package.json 一致')
  const notesFile = path.join(root, 'release-notes', `${pkg.version}.md`)
  const notes = await readFile(notesFile, 'utf8')
  if (!notes.trim()) throw Error(`更新说明不能为空：${notesFile}`)
  if (!/^## 新增功能$/m.test(notes) || !/^## 问题修复$/m.test(notes))
    throw Error('中文更新说明必须包含新增功能和问题修复')
  return { version: pkg.version, tag, notes, notesFile }
}
export async function inspectArtifacts(
  directory,
  version,
  requestedTargets = TARGETS
) {
  const targets = []
  for (const target of requestedTargets) {
    const folder = path.join(directory, target)
    const metadata = JSON.parse(
      await readFile(path.join(folder, 'updater.json'), 'utf8')
    )
    if (metadata.version !== version) throw Error(`${target} 版本不匹配`)
    const platformKey =
      target === 'darwin/arm64'
        ? 'darwin-aarch64'
        : target === 'darwin/x64'
          ? 'darwin-x86_64'
          : 'windows-x86_64'
    if (metadata.target !== platformKey) throw Error(`${target} 架构不匹配`)
    const required = target.startsWith('darwin/')
      ? ['.dmg', '.app.tar.gz']
      : ['.exe']
    if (
      required.some((ext) => !metadata.assets.some((a) => a.name.endsWith(ext)))
    )
      throw Error(`${target} 缺少安装包`)
    const assets = []
    for (const asset of metadata.assets) {
      if (
        path.basename(asset.name) !== asset.name ||
        !asset.name.includes(`-${version}-`)
      )
        throw Error('安装包名称无效')
      const file = path.join(folder, asset.name)
      const { size } = await stat(file)
      if (size > MAX_ASSET_SIZE)
        throw Error(
          `${asset.name} 超过 100 MiB；不会创建 Release 或更新 latest`
        )
      const sha512 = createHash('sha512')
        .update(await readFile(file))
        .digest('base64')
      if (size !== asset.size || sha512 !== asset.sha512)
        throw Error(`${asset.name} 哈希不匹配`)
      if (asset.name.endsWith('.app.tar.gz') || asset.name.endsWith('.exe')) {
        const signature = (await readFile(file + '.sig', 'utf8')).trim()
        if (!signature || signature !== asset.signature)
          throw Error(`${asset.name} 更新签名不匹配`)
      }
      assets.push({ ...asset, file })
    }
    targets.push({ target, metadata, assets })
  }
  return targets
}
export async function prepareRelease({
  tag,
  artifacts,
  root = ROOT,
  requestedTargets = TARGETS,
}) {
  const release = await readRelease(tag, root)
  if (!artifacts) return release
  const targets = await inspectArtifacts(
    path.resolve(artifacts),
    release.version,
    requestedTargets
  )
  const manifest = { ...release, targets }
  await writeFile(
    path.join(artifacts, 'release-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
  )
  return manifest
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const { values } = parseArgs({
    options: { tag: { type: 'string' }, artifacts: { type: 'string' } },
  })
  const result = await prepareRelease({
    tag: values.tag || process.env.RELEASE_TAG,
    artifacts: values.artifacts,
  })
  console.log(
    `${result.tag} 中文更新说明${values.artifacts ? '与所有 Tauri 产物' : ''}检查通过`
  )
}
