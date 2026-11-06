import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { UpdateService } from '../electron/updater.mjs'

function fixture({
  packaged = true,
  releases,
  beforeInstall = async () => {},
} = {}) {
  const updater = new EventEmitter()
  updater.setFeedURL = (feed) => {
    updater.feed = feed
  }
  updater.checkForUpdates = async () => ({
    isUpdateAvailable: true,
    updateInfo: { version: '0.3.0' },
  })
  updater.downloadUpdate = async () => {
    updater.emit('download-progress', { percent: 52 })
    updater.emit('update-downloaded')
  }
  updater.quitAndInstall = () => {
    updater.installed = true
  }
  const events = []
  const errors = []
  const service = new UpdateService({
    version: '0.2.0',
    packaged,
    platform: 'darwin',
    arch: 'arm64',
    updater,
    onChange: (state) => events.push(state),
    onError: (error) => errors.push(error),
    beforeInstall,
    request: async () => ({
      ok: true,
      json: async () =>
        releases || [
          {
            tag_name: 'v0.3.0',
            body: '修复采集\n优化错误日志',
            prerelease: false,
          },
        ],
    }),
  })
  return { service, updater, events, errors }
}

test('release notes and architecture feed are selected without automatically downloading or installing', async () => {
  const { service, updater, events } = fixture()
  const state = await service.check()
  assert.equal(
    updater.feed.url,
    'https://gitee.com/zhenxiaoguo/dalanchong/raw/main/updates/darwin/arm64/'
  )
  assert.equal(updater.autoDownload, false)
  assert.equal(updater.autoInstallOnAppQuit, false)
  assert.equal(updater.allowDowngrade, false)
  assert.equal(state.status, 'available')
  assert.equal(state.releaseNotes, '修复采集\n优化错误日志')
  assert.equal(updater.installed, undefined)
  await service.download()
  assert.ok(events.some((event) => event.percent === 52))
  assert.equal(service.state.status, 'downloaded')
  assert.equal(updater.installed, undefined)
  await service.install()
  assert.equal(updater.installed, true)
})

test('source mode compares numeric stable versions and cannot install a release', async () => {
  const { service, updater } = fixture({
    packaged: false,
    releases: [
      { tag_name: 'v0.9.0', body: '旧版' },
      { tag_name: 'v0.10.0', body: '新版本' },
      { tag_name: 'v1.0.0-beta.1', body: '预览', prerelease: true },
    ],
  })
  updater.checkForUpdates = () => {
    throw Error('source must not invoke native updater')
  }
  assert.equal((await service.check()).version, '0.10.0')
  assert.equal(service.state.releaseNotes, '新版本')
  assert.equal((await service.download()).error, '请使用安装版升级')
  assert.equal(updater.installed, undefined)
})

test('download verification failure is logged once and prevents installation', async () => {
  const { service, updater, errors } = fixture()
  await service.check()
  updater.downloadUpdate = async () => {
    const error = Error('sha512 checksum mismatch')
    updater.emit('error', error)
    throw error
  }
  assert.match((await service.download()).error, /checksum mismatch/)
  assert.equal(errors.length, 1)
  assert.equal((await service.install()).error, '请先下载更新')
  assert.equal(updater.installed, undefined)
})

test('running work or persistence errors block restart and allow retry after the problem is resolved', async () => {
  let busy = true
  let saved = false
  const { service, updater } = fixture({
    beforeInstall: async () => {
      if (busy) throw Error('请先停止采集或邀约任务，再安装更新')
      saved = true
    },
  })
  await service.check()
  await service.download()
  assert.match((await service.install()).error, /停止采集/)
  assert.equal(updater.installed, undefined)
  busy = false
  await service.install()
  assert.equal(saved, true)
  assert.equal(updater.installed, true)
})

test('an empty release repository means no available update without an error', async () => {
  const { service, updater, errors } = fixture({ releases: [] })
  updater.checkForUpdates = () => {
    throw Error('no feed before first release')
  }
  assert.equal((await service.check()).status, 'not-available')
  assert.deepEqual(errors, [])
})
