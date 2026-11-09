/**
 * AI module map
 * Purpose: publish prepared native artifacts and update metadata to the configured repositories.
 * Entry: publishRelease and CLI flags; helper exports support metadata/access inspection.
 * Flow: prepareRelease validates local inputs; upload/reconcile Gitee attachments, verify
 * their public downloads, rewrite updater URLs, and synchronize release text/metadata.
 * Side effects: creates remote release data and commits publication metadata through Git.
 * Invariants: upload assets before changing latest pointers; public URLs contain no token;
 * GitHub/Gitee use the same versioned Chinese notes. Tokens come only from environment.
 * Run publication/access operations only within an explicitly authorized release task.
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, openAsBlob } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { prepareRelease } from './prepare-release.mjs'

const GITEE_REPO = 'zhenxiaoguo/dalanchong'
const GITHUB_REPO = 'crazyniu/dalanchong-desktop'
const API = `https://gitee.com/api/v5/repos/${GITEE_REPO}`

export function attachmentUrl(name, attachments) {
  const attachment = attachments.find((a) => a.name === name)
  if (!attachment?.browser_download_url)
    throw Error(`Gitee 未返回 ${name} 的下载地址`)
  const url = new URL(attachment.browser_download_url)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'gitee.com' ||
    url.username ||
    url.password ||
    url.searchParams.has('access_token')
  )
    throw Error(`Gitee 附件 ${name} 未返回公开稳定的下载地址`)
  return url.href
}
export function rewriteMetadata(release, attachments) {
  return {
    version: release.version,
    notes: release.notes,
    pub_date: new Date().toISOString(),
    platforms: Object.fromEntries(
      release.targets.map(({ metadata, assets }) => {
        const archive = assets.find((a) => a.signature)
        return [
          metadata.target,
          {
            signature: archive.signature,
            url: attachmentUrl(archive.name, attachments),
          },
        ]
      })
    ),
  }
}

async function gitee(endpoint, { method = 'GET', json, form } = {}) {
  const body =
    form ||
    (json
      ? JSON.stringify({ ...json, access_token: process.env.GITEE_TOKEN })
      : undefined)
  const response = await fetch(`${API}${endpoint}`, {
    method,
    body,
    ...(json ? { headers: { 'content-type': 'application/json' } } : {}),
  })
  if (!response.ok)
    throw Error(`Gitee ${method} ${endpoint} 失败：HTTP ${response.status}`)
  return response.json()
}

async function verifyAttachment(attachment, asset) {
  const url = attachmentUrl(asset.name, [attachment])
  const download = asset.file + '.download'
  try {
    execFileSync('curl', [
      '--fail', '--location', '--show-error', '--connect-timeout', '30',
      '--max-time', '180', '--output', download, url,
    ], { stdio: ['ignore', 'ignore', 'inherit'] })
    const hash = createHash('sha512')
    let size = 0
    for await (const chunk of createReadStream(download)) {
      size += chunk.length
      hash.update(chunk)
    }
    if (size !== asset.size || hash.digest('base64') !== asset.sha512)
      throw Error(`Gitee 附件 ${asset.name} 的匿名下载哈希不匹配，不更新 latest`)
  } finally {
    await rm(download, { force: true })
  }
}

export async function verifyPublishAccess() {
  if (!process.env.GITEE_TOKEN) throw Error('缺少环境变量 GITEE_TOKEN')
  const read = async (endpoint) => {
    const url = new URL(`https://gitee.com/api/v5${endpoint}`)
    url.searchParams.set('access_token', process.env.GITEE_TOKEN)
    const response = await fetch(url)
    if (!response.ok) throw Error(`Gitee 访问检查失败：HTTP ${response.status}`)
    return response.json()
  }
  const user = await read('/user')
  const repository = await read(`/repos/${GITEE_REPO}`)
  const branch = await read(`/repos/${GITEE_REPO}/branches/main`)
  if (
    user.login !== 'zhenxiaoguo' ||
    repository.full_name !== GITEE_REPO ||
    !repository.public ||
    branch.name !== 'main'
  )
    throw Error('Gitee 令牌身份、公有仓库或 main 分支与发布配置不一致')
  console.log(
    'Gitee 仓库所有者身份、公有仓库和 main 分支检查通过；未创建 Release、上传附件或更新元数据'
  )
}

export async function publishRelease({
  tag,
  artifacts,
  check = false,
  requestedTargets,
}) {
  // All supported targets and every attachment are checked before any remote mutation.
  const release = await prepareRelease({ tag, artifacts, requestedTargets })
  if (check) {
    console.log(`${tag} 全量发布预检通过，未发布`)
    return
  }
  for (const key of ['GH_TOKEN', 'GITEE_TOKEN'])
    if (!process.env[key]) throw Error(`缺少环境变量 ${key}`)
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'dalanchong-release-'))
  const checkout = path.join(temporary, 'gitee')
  const askpass = path.join(temporary, 'askpass.sh')
  await writeFile(
    askpass,
    '#!/bin/sh\ncase "$1" in\n  *Username*) printf "%s\\n" "zhenxiaoguo" ;;\n  *Password*) printf "%s\\n" "$GITEE_TOKEN" ;;\nesac\n',
    { mode: 0o700 }
  )
  const git = (...args) =>
    execFileSync('git', ['-c', 'credential.helper=', ...args], {
      cwd: checkout,
      env: { ...process.env, GIT_ASKPASS: askpass, GIT_TERMINAL_PROMPT: '0' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  const gh = (...args) =>
    execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  try {
    await mkdir(checkout)
    git('init', '-b', 'main')
    git('remote', 'add', 'origin', `https://gitee.com/${GITEE_REPO}.git`)
    git('config', 'user.name', 'dalanchong-release')
    git('config', 'user.email', 'release@users.noreply.github.com')
    const head = git('ls-remote', '--heads', 'origin', 'main').trim()
    if (head) {
      git('fetch', '--depth=1', 'origin', 'main')
      git('reset', '--hard', 'FETCH_HEAD')
    } else {
      await writeFile(
        path.join(checkout, 'README.md'),
        '# 大懒虫\n\n安装包与更新元数据由 GitHub Release 同步到本仓库。\n\n源码：https://github.com/crazyniu/dalanchong-desktop\n'
      )
      git('add', 'README.md')
      git('commit', '-m', 'Initialize release distribution')
      git('push', 'origin', 'main')
    }
    const assets = release.targets.flatMap((t) => t.assets).sort(
      (a, b) => Number(b.name.endsWith('.exe')) - Number(a.name.endsWith('.exe'))
    )
    let existing
    try {
      existing = JSON.parse(
        gh('release', 'view', tag, '--repo', GITHUB_REPO, '--json', 'isDraft')
      )
    } catch {
      existing = null
    }
    if (existing && !existing.isDraft) throw Error(`${tag} 已发布，不能覆盖`)
    if (!existing)
      gh(
        'release',
        'create',
        tag,
        '--repo',
        GITHUB_REPO,
        '--verify-tag',
        '--draft',
        '--title',
        `大懒虫 ${release.version}`,
        '--notes-file',
        release.notesFile
      )
    else
      gh(
        'release',
        'edit',
        tag,
        '--repo',
        GITHUB_REPO,
        '--title',
        `大懒虫 ${release.version}`,
        '--notes-file',
        release.notesFile
      )
    console.log('正在上传 GitHub Release 附件')
    gh(
      'release',
      'upload',
      tag,
      '--repo',
      GITHUB_REPO,
      '--clobber',
      ...assets.map((a) => a.file)
    )
    const lookupUrl = new URL(`${API}/releases/tags/${encodeURIComponent(tag)}`)
    lookupUrl.searchParams.set('access_token', process.env.GITEE_TOKEN)
    const lookup = await fetch(lookupUrl)
    if (!lookup.ok && lookup.status !== 404)
      throw Error(`Gitee 读取 ${tag} 失败：HTTP ${lookup.status}`)
    // Gitee returns HTTP 200 with JSON null when the tag has no release yet.
    const giteeRelease = lookup.ok ? await lookup.json() : null
    const created = giteeRelease ?? await gitee('/releases', {
          method: 'POST',
          json: {
            tag_name: tag,
            name: `大懒虫 ${release.version}`,
            body: release.notes,
            target_commitish: 'main',
            prerelease: false,
          },
        })
    const attachments = []
    for (const asset of assets) {
      let attachment = created.assets.find((item) => item.name === asset.name)
      if (!attachment) {
        console.log(`正在上传 Gitee 附件：${asset.name}（${asset.size} 字节）`)
        const form = new FormData()
        form.set('access_token', process.env.GITEE_TOKEN)
        form.set('file', await openAsBlob(asset.file), asset.name)
        attachment = await gitee(`/releases/${created.id}/attach_files`, {
          method: 'POST',
          form,
        })
      }
      console.log(`正在核对 Gitee 下载：${asset.name}`)
      await verifyAttachment(attachment, asset)
      attachments.push(attachment)
      console.log(`Gitee 附件已核验：${asset.name}`)
    }
    const folder = path.join(checkout, 'updates', 'tauri')
    await mkdir(folder, { recursive: true })
    await writeFile(
      path.join(folder, 'latest.json'),
      JSON.stringify(rewriteMetadata(release, attachments), null, 2) + '\n'
    )
    gh('release', 'edit', tag, '--repo', GITHUB_REPO, '--draft=false')
    // One non-forced push exposes all platform metadata together, after all assets work.
    git('add', 'updates')
    git('commit', '-m', `Publish update metadata for ${tag}`)
    git('push', 'origin', 'HEAD:main')
    console.log(`${tag} 已发布到 Gitee Release，所有平台 latest 元数据已提交`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  const { values } = parseArgs({
    options: {
      tag: { type: 'string' },
      artifacts: { type: 'string', default: 'dist-release/tauri' },
      check: { type: 'boolean', default: false },
      targets: { type: 'string' },
      'verify-access': { type: 'boolean', default: false },
    },
  })
  if (values['verify-access']) await verifyPublishAccess()
  else
    await publishRelease({
      tag: values.tag || process.env.RELEASE_TAG,
      artifacts: values.artifacts,
      check: values.check,
      requestedTargets: values.targets?.split(','),
    })
}
