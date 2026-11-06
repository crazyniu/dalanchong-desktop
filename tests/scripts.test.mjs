import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  inspectArtifacts,
  MAX_ASSET_SIZE,
  readRelease,
  TARGETS,
  validateTag,
} from '../scripts/prepare-release.mjs'
import { rewriteMetadata } from '../scripts/publish-release.mjs'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dalanchong-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test('版本与中文发布说明必须完整匹配', async (t) => {
  const root = await fixture(t)
  await mkdir(path.join(root, 'release-notes'))
  await mkdir(path.join(root, 'src-tauri'))
  await writeFile(
    path.join(root, 'src-tauri/Cargo.toml'),
    '[package]\nversion = "1.2.3"\n'
  )
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3' })
  )
  const notes = '## 新增功能\n功能\n## 问题修复\n修复'
  await writeFile(path.join(root, 'release-notes/1.2.3.md'), notes)
  assert.equal((await readRelease('v1.2.3', root)).notes, notes)
  assert.throws(() => validateTag('1.2.3', 'v1.2.2'), /一致/)
  await writeFile(path.join(root, 'release-notes/1.2.3.md'), '只有说明')
  await assert.rejects(readRelease('v1.2.3', root), /新增功能和问题修复/)
})
test('三架构哈希签名文件预检后生成 Tauri 公共下载元数据', async (t) => {
  const root = await fixture(t)
  for (const target of TARGETS) {
    const folder = path.join(root, target)
    await mkdir(folder, { recursive: true })
    const assets = []
    for (const ext of target.startsWith('darwin/')
      ? ['dmg', 'app.tar.gz']
      : ['exe']) {
      const name = `dalanchong-1.2.3-${target.replace('/', '-')}.${ext}`
      const data = Buffer.from(`test-${name}`)
      await writeFile(path.join(folder, name), data)
      const asset = {
        name,
        size: data.length,
        sha512: createHash('sha512').update(data).digest('base64'),
      }
      if (ext !== 'dmg') {
        asset.signature = 'fixture-signature'
        await writeFile(path.join(folder, name + '.sig'), asset.signature)
      }
      assets.push(asset)
    }
    await writeFile(
      path.join(folder, 'updater.json'),
      JSON.stringify({
        version: '1.2.3',
        target:
          target === 'darwin/arm64'
            ? 'darwin-aarch64'
            : target === 'darwin/x64'
              ? 'darwin-x86_64'
              : 'windows-x86_64',
        assets,
      })
    )
  }
  const targets = await inspectArtifacts(root, '1.2.3')
  const attachments = targets.flatMap((t) =>
    t.assets.map((a) => ({
      name: a.name,
      browser_download_url: `https://gitee.com/zhenxiaoguo/dalanchong/attach_files/123/download/${a.name}`,
    }))
  )
  const release = { version: '1.2.3', notes: '中文说明', targets }
  const metadata = rewriteMetadata(release, attachments)
  assert.equal(metadata.notes, '中文说明')
  assert.equal(Object.keys(metadata.platforms).length, 3)
  assert.equal(
    metadata.platforms['darwin-aarch64'].signature,
    'fixture-signature'
  )
  assert.throws(() => rewriteMetadata(release, []), /未返回/)
  await truncate(targets[0].assets[0].file, MAX_ASSET_SIZE + 1)
  await assert.rejects(
    inspectArtifacts(root, '1.2.3'),
    /不会创建 Release 或更新 latest/
  )
})
