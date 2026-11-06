import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { parse } from 'yaml'

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
  const notesFile = path.join(root, 'release-notes', `${pkg.version}.md`)
  const notes = await readFile(notesFile, 'utf8')
  if (!notes.trim()) throw Error(`更新说明不能为空：${notesFile}`)
  return { version: pkg.version, tag, notes, notesFile }
}
export async function inspectArtifacts(directory, version) {
  const targets = []
  const oversized = []
  for (const target of TARGETS) {
    const folder = path.join(directory, target)
    const metadataName = target.startsWith('darwin/')
      ? 'latest-mac.yml'
      : 'latest.yml'
    const metadata = parse(
      await readFile(path.join(folder, metadataName), 'utf8')
    )
    if (metadata.version !== version)
      throw Error(`${target}/${metadataName} 版本不匹配`)
    const names = (await readdir(folder)).filter((name) =>
      /\.(dmg|zip|exe|blockmap)$/.test(name)
    )
    const required = target.startsWith('darwin/') ? ['.dmg', '.zip'] : ['.exe']
    if (required.some((ext) => !names.some((name) => name.endsWith(ext))))
      throw Error(`${target} 缺少安装包`)
    const assets = []
    for (const name of names) {
      const file = path.join(folder, name)
      const { size } = await stat(file)
      if (size > MAX_ASSET_SIZE)
        oversized.push(
          `${target}/${name}（${(size / 1024 / 1024).toFixed(1)} MiB）`
        )
      assets.push({ name, file, size })
    }
    targets.push({ target, metadataName, metadata, assets })
  }
  if (oversized.length)
    throw Error(
      `Gitee 普通 Release 附件上限为 100 MiB，以下文件超限；不会创建 Release 或更新 latest：\n${oversized.join('\n')}`
    )
  for (const { target, metadata, assets } of targets) {
    for (const asset of assets)
      asset.sha512 = createHash('sha512')
        .update(await readFile(asset.file))
        .digest('base64')
    for (const entry of metadata.files) {
      const asset = assets.find((asset) => asset.name === entry.url)
      if (
        !asset ||
        asset.sha512 !== entry.sha512 ||
        (entry.size !== undefined && asset.size !== entry.size)
      )
        throw Error(`${target}/${entry.url} 的元数据与实际文件不匹配`)
    }
  }
  return targets
}
export async function prepareRelease({ tag, artifacts, root = ROOT }) {
  const release = await readRelease(tag, root)
  if (!artifacts) return release
  const targets = await inspectArtifacts(
    path.resolve(artifacts),
    release.version
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
  const tag = values.tag || process.env.RELEASE_TAG
  const artifacts = values.artifacts
  const result = await prepareRelease({ tag, artifacts })
  console.log(`${result.tag} 更新说明${artifacts ? '与所有产物' : ''}检查通过`)
}
