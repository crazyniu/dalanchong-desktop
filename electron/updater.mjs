export const releaseRepository = 'zhenxiaoguo/dalanchong'
const releasesUrl = `https://gitee.com/api/v5/repos/${releaseRepository}/releases?per_page=100`

function versionOf(release) {
  return release.tag_name.replace(/^v/, '')
}

export function compareVersions(left, right) {
  const a = left.split('.').map(Number)
  const b = right.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}

export class UpdateService {
  constructor({
    version,
    packaged,
    platform,
    arch,
    updater,
    onChange,
    onError,
    beforeInstall,
    request = fetch,
  }) {
    Object.assign(this, { updater, onChange, onError, beforeInstall, request })
    this.state = {
      currentVersion: version,
      status: 'idle',
      canInstall: packaged && ['darwin', 'win32'].includes(platform),
    }
    this.ready = false
    this.available = false
    this.checking = null
    this.lastError = null
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false
    updater.allowDowngrade = false
    updater.allowPrerelease = false
    updater.disableDifferentialDownload = true
    updater.disableWebInstaller = true
    updater.logger = null
    updater.setFeedURL({
      provider: 'generic',
      url: `https://gitee.com/${releaseRepository}/raw/main/updates/${platform}/${arch}/`,
      useMultipleRangeRequest: false,
    })
    updater.on('error', (error) => this.fail(error))
    updater.on('download-progress', ({ percent }) =>
      this.publish({ status: 'downloading', percent })
    )
    updater.on('update-downloaded', () => {
      this.ready = true
      this.publish({ status: 'downloaded', percent: 100, error: undefined })
    })
  }

  publish(patch) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
    return this.state
  }

  fail(error) {
    if (this.lastError !== error) {
      this.lastError = error
      this.onError(error)
    }
    return this.publish({ status: 'error', error: error.message })
  }

  check() {
    if (this.state.status === 'downloading' || this.ready)
      return Promise.resolve(this.state)
    if (this.checking) return this.checking
    this.checking = this.checkRelease().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  async checkRelease() {
    this.lastError = null
    this.publish({ status: 'checking', error: undefined, percent: undefined })
    try {
      const response = await this.request(releasesUrl, {
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok)
        throw Error(`读取 Gitee Release 失败（HTTP ${response.status}）`)
      const releases = await response.json()
      const stable = releases
        .filter(
          (r) =>
            !r.prerelease && !r.draft && /^v?\d+\.\d+\.\d+$/.test(r.tag_name)
        )
        .sort((a, b) => compareVersions(versionOf(b), versionOf(a)))
      if (!stable.length) {
        this.available = false
        return this.publish({
          status: 'not-available',
          version: this.state.currentVersion,
          releaseNotes: '',
        })
      }
      let release = stable[0]
      let version = versionOf(release)
      let available = compareVersions(version, this.state.currentVersion) > 0
      if (this.state.canInstall) {
        // The platform feed is updated only after every Release asset is uploaded.
        const result = await this.updater.checkForUpdates()
        version = result.updateInfo.version
        available = result.isUpdateAvailable
        release = stable.find((r) => versionOf(r) === version)
        if (available && !release)
          throw Error(`Gitee Release 中缺少 v${version} 的发布说明`)
      }
      this.available = available
      return this.publish({
        status: available ? 'available' : 'not-available',
        version,
        releaseNotes: release?.body || '',
      })
    } catch (error) {
      return this.fail(error)
    }
  }

  async download() {
    if (this.state.status === 'downloading' || this.ready) return this.state
    this.lastError = null
    try {
      if (!this.state.canInstall) throw Error('请使用安装版升级')
      if (!this.available) throw Error('请先检查更新')
      this.publish({ status: 'downloading', percent: 0, error: undefined })
      await this.updater.downloadUpdate()
      return this.state
    } catch (error) {
      return this.fail(error)
    }
  }

  async install() {
    this.lastError = null
    try {
      if (!this.state.canInstall || !this.ready) throw Error('请先下载更新')
      await this.beforeInstall()
      this.updater.quitAndInstall(false, true)
      return this.state
    } catch (error) {
      return this.fail(error)
    }
  }
}
