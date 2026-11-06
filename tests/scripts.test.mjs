import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, truncate, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { stringify } from 'yaml'
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
test('release version and mandatory update notes must match the tag', async (t) => {
  const root = await fixture(t)
  await mkdir(path.join(root, 'release-notes'))
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ version: '1.2.3' })
  )
  await writeFile(path.join(root, 'release-notes/1.2.3.md'), '修复采集流程')
  assert.equal((await readRelease('v1.2.3', root)).notes, '修复采集流程')
  assert.throws(() => validateTag('1.2.3', 'v1.2.2'), /一致/)
  await writeFile(path.join(root, 'release-notes/1.2.3.md'), '')
  await assert.rejects(readRelease('v1.2.3', root), /不能为空/)
})
test('all target sizes and hashes are checked; update files use returned Gitee URLs', async (t) => {
  const root = await fixture(t)
  for (const target of TARGETS) {
    const folder = path.join(root, target)
    await mkdir(folder, { recursive: true })
    const extensions = target.startsWith('darwin/') ? ['dmg', 'zip'] : ['exe']
    const files = []
    for (const ext of extensions) {
      const name = `dalanchong-1.2.3-${target.replace('/', '-')}.${ext}`
      const data = Buffer.from(`test-${name}`)
      await writeFile(path.join(folder, name), data)
      files.push({
        url: name,
        sha512: createHash('sha512').update(data).digest('base64'),
        size: data.length,
      })
    }
    await writeFile(
      path.join(
        folder,
        target.startsWith('darwin/') ? 'latest-mac.yml' : 'latest.yml'
      ),
      stringify({
        version: '1.2.3',
        files,
        path: files[0].url,
        sha512: files[0].sha512,
      })
    )
  }
  const targets = await inspectArtifacts(root, '1.2.3')
  const target = targets[0]
  const attachments = target.assets.map((asset) => ({
    name: asset.name,
    browser_download_url: `https://gitee.com/zhenxiaoguo/dalanchong/attach_files/123/download/${asset.name}`,
  }))
  const metadata = rewriteMetadata(target.metadata, attachments, '修复说明')
  assert.equal(metadata.files[0].url, attachments[0].browser_download_url)
  assert.equal(metadata.files[0].sha512, target.metadata.files[0].sha512)
  assert.equal(metadata.path, attachments[0].browser_download_url)
  assert.equal(metadata.releaseNotes, '修复说明')
  assert.throws(() => rewriteMetadata(target.metadata, [], ''), /未返回/)
  await truncate(target.assets[0].file, MAX_ASSET_SIZE + 1)
  await assert.rejects(
    inspectArtifacts(root, '1.2.3'),
    /不会创建 Release 或更新 latest/
  )
})
