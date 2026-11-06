import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  safeStorage,
  webContents,
  Menu,
  dialog,
} from 'electron'
import electronUpdater from 'electron-updater'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { restoreCookieSnapshot } from './cookie-snapshot.mjs'
import { Diagnostics } from './diagnostics.mjs'
import { LicenseService } from './license.mjs'
import { urls, makeApi, readQuota, parseCapture } from './platform.mjs'
import { InviteRunner } from './runner.mjs'
import { UpdateService } from './updater.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
app.setName('大懒虫')
// Keep the existing data location when changing the display name.
app.setPath(
  'userData',
  process.env.ASSISTANT_TEST_DATA ||
    path.join(app.getPath('appData'), '电商助手')
)
const connections = new Map()
const preparations = new Map()
let window
let runner
let license
let data
let diagnostics
let updates
let installingUpdate = false
let saveChain = Promise.resolve()
let closing = false
const send = (event) => {
  if (window && !window.isDestroyed())
    window.webContents.send('assistant:event', event)
}
const emit = () => send({ type: 'runtime', data })
let directory
async function saveBeforeExit() {
  for (const c of connections.values()) {
    clearTimeout(c.saveTimer)
    await c.cookieSave
    await saveCookies(c)
  }
  await save()
}
function save() {
  const snapshot = JSON.stringify({ ...data, logs: undefined })
  const pending = saveChain.then(async () => {
    const file = path.join(directory, 'runtime.json')
    await writeFile(file + '.tmp', snapshot, { mode: 0o600 })
    await rename(file + '.tmp', file)
  })
  saveChain = pending.catch(() => {})
  return pending
}
function reportError(context, error, accountId) {
  const connection = connections.get(accountId)
  diagnostics.record({
    level: 'error',
    message: `${context}：${error.message}`,
    accountId,
    platform: connection?.platform,
    response: error.response,
  })
}
async function exportLogs() {
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: '导出错误日志',
    defaultPath: `电商助手-错误日志-${new Date().toISOString().slice(0, 10)}.ndjson`,
    filters: [{ name: '错误日志', extensions: ['ndjson'] }],
  })
  if (canceled) return false
  await diagnostics.exportTo(filePath)
  return true
}
async function persistCookies(connection) {
  await connection.session.cookies.flushStore()
  const cookies = await connection.session.cookies.get({})
  const encrypted = await safeStorage.encryptStringAsync(
    JSON.stringify(cookies)
  )
  const file = path.join(directory, `${connection.id}.cookies`)
  await writeFile(file + '.tmp', encrypted, {
    mode: 0o600,
  })
  await rename(file + '.tmp', file)
  send({
    type: 'account',
    id: connection.id,
    patch: { savedAt: new Date().toISOString() },
  })
}
function saveCookies(connection) {
  const pending = connection.cookieSave.then(() => persistCookies(connection))
  connection.cookieSave = pending.catch(() => {})
  return pending
}
async function prepareAccount(account) {
  if (connections.has(account.id)) return
  if (!preparations.has(account.id)) {
    const pending = createAccount(account).finally(() =>
      preparations.delete(account.id)
    )
    preparations.set(account.id, pending)
  }
  return preparations.get(account.id)
}
async function createAccount({ id, platform }) {
  if (!/^[\w-]+$/.test(id) || !Object.hasOwn(urls, platform))
    throw Error('无效账号')
  const ses = session.fromPartition(`persist:${platform}:${id}`)
  const cookiePath = path.join(directory, `${id}.cookies`)
  send({ type: 'account', id, patch: { status: 'offline', quotaError: '' } })
  await restoreCookieSnapshot({
    file: cookiePath,
    encryption: safeStorage,
    cookies: ses.cookies,
    onError: (error, backup) =>
      diagnostics.record({
        level: 'error',
        accountId: id,
        platform,
        message: `登录快照恢复失败，已备份为 ${path.basename(backup)}；继续检查网页会话，失效时请重新登录。原因：${error.message}`,
      }),
  })
  const connection = {
    id,
    platform,
    session: ses,
    capture: {},
    ownRequests: new Set(),
    contents: null,
    saveTimer: null,
    cookieSave: Promise.resolve(),
  }
  connections.set(id, connection)
  ses.webRequest.onBeforeRequest(
    {
      urls: [
        'https://cps.kwaixiaodian.com/*',
        'https://buyin.jinritemai.com/*',
      ],
    },
    (details, callback) => {
      callback({ cancel: false })
      try {
        const captured = parseCapture(details)
        if (captured) {
          const signature = `${captured.path}\n${JSON.stringify(captured.body)}`
          if (connection.ownRequests.has(signature)) return
          connection.capture[captured.kind] = captured
          send({
            type: 'capture',
            id,
            ready: Boolean(connection.capture.search),
          })
        }
      } catch (error) {
        reportError('读取网页筛选失败', error, id)
        send({ type: 'error', message: '未能读取当前筛选，请重新应用筛选条件' })
      }
    }
  )
  ses.cookies.on('changed', () => {
    clearTimeout(connection.saveTimer)
    connection.saveTimer = setTimeout(() => {
      saveCookies(connection).catch((error) => {
        reportError('登录数据保存失败', error, id)
        send({ type: 'error', message: `登录数据保存失败：${error.message}` })
      })
      if (connection.contents && !connection.contents.isDestroyed())
        refreshAccount(id).catch((error) =>
          reportError('刷新账号失败', error, id)
        )
    }, 1200)
  })
  ses.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
}
function onQuota(id, quota) {
  send({
    type: 'account',
    id,
    patch: {
      status: 'online',
      quotaError: '',
      quota: quota.remaining,
      limit: quota.limit,
      quotaRows: quota.rows,
    },
  })
}
async function refreshAccount(id) {
  if (!license.state.valid) return
  const c = connections.get(id)
  if (!c.contents || c.contents.isDestroyed()) return
  try {
    const quota = await readQuota(makeApi(c.contents, c.platform), c.platform)
    onQuota(id, quota)
    await saveCookies(c)
  } catch (error) {
    reportError('读取账号额度或保存登录数据失败', error, id)
    if (error.login) send({ type: 'account', id, patch: { status: 'expired' } })
    else send({ type: 'account', id, patch: { quotaError: error.message } })
  }
}
function handle(channel, callback, licensed = true) {
  ipcMain.handle(`assistant:${channel}`, async (event, ...args) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame
    )
      throw Error('请求来源无效')
    try {
      if (licensed) await license.requireValid()
      return await callback(...args)
    } catch (error) {
      const actions = {
        'prepare-account': '准备账号失败',
        'bind-guest': '绑定账号网页失败',
        'refresh-account': '刷新账号失败',
        collect: '启动采集失败',
        start: '启动邀约失败',
        stop: '停止任务失败',
        'resolve-record': '核实邀约记录失败',
        'remove-account': '移除账号失败',
        initialize: '读取运行数据失败',
        'export-logs': '导出错误日志失败',
        'license-verify': '验证授权失败',
        'license-activate': '激活失败',
      }
      const accountId =
        channel === 'prepare-account'
          ? args[0].id
          : channel === 'resolve-record'
            ? data.records.find((r) => r.id === args[0])?.accountId
            : connections.has(args[0])
              ? args[0]
              : undefined
      if (!error.logged) reportError(actions[channel], error, accountId)
      throw error
    }
  })
}

app
  .whenReady()
  .then(async () => {
    directory = path.join(app.getPath('userData'), 'assistant-data')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    diagnostics = new Diagnostics({
      file: path.join(directory, 'errors.ndjson'),
      onEntry: () => {
        if (data) {
          data.logs = diagnostics.entries
          emit()
        }
      },
    })
    await diagnostics.initialize()
    license = new LicenseService({
      file: path.join(directory, 'license.json'),
      encryption: safeStorage,
      onChange: (state) => send({ type: 'license', state }),
    })
    await license.initialize()
    if (process.platform === 'darwin')
      app.dock.setIcon(path.join(root, '../assets/icons/mac-1024.png'))
    const file = path.join(directory, 'runtime.json')
    data = existsSync(file)
      ? JSON.parse(await readFile(file, 'utf8'))
      : { records: [], tasks: {}, collections: [], talents: [] }
    data.talents ??= []
    data.logs = diagnostics.entries
    for (const record of data.records)
      if (record.status === 'sending') {
        record.status = 'review'
        record.note = '上次发送未保存最终结果，请在平台核实'
      }
    for (const task of Object.values(data.tasks)) {
      task.logs = (task.logs || []).filter((entry) => entry.level === 'error')
      if (task.status === 'running') {
        task.status = 'stopped'
        task.current = '上次任务已中断'
        diagnostics.record({
          level: 'error',
          accountId: task.accountId,
          taskId: task.startedAt,
          kind: task.kind,
          message: '上次任务意外中断，请检查采集列表或待核实记录',
        })
      }
    }
    await save()
    runner = new InviteRunner({
      data,
      save,
      emit,
      onQuota,
      onLog: (entry) => diagnostics.record(entry),
      getConnection: (id) => {
        const c = connections.get(id)
        if (!c?.contents || c.contents.isDestroyed())
          throw Error('请先打开该账号的邀约网页')
        const api = makeApi(c.contents, c.platform)
        return {
          platform: c.platform,
          api: async (...args) => {
            await license.requireValid()
            // Authorization can take time; a stopped job must not send afterward.
            if (runner.jobs.get(id)?.stopped)
              throw Object.assign(Error('已停止'), { beforeSend: true })
            const signature = `${args[0].split('?')[0]}\n${JSON.stringify(args[1])}`
            c.ownRequests.add(signature)
            try {
              return await api(...args)
            } catch (error) {
              if (error.login)
                send({
                  type: 'account',
                  id,
                  patch: { status: 'expired', quotaError: error.message },
                })
              throw error
            } finally {
              c.ownRequests.delete(signature)
            }
          },
          capture: c.capture,
        }
      },
    })
    updates = new UpdateService({
      version: app.getVersion(),
      packaged: app.isPackaged,
      platform: process.platform,
      arch: process.arch,
      updater: electronUpdater.autoUpdater,
      onChange: (state) => send({ type: 'update', state }),
      onError: (error) => {
        if (installingUpdate) {
          closing = false
          installingUpdate = false
        }
        reportError('软件更新失败', error)
      },
      beforeInstall: async () => {
        if (runner.jobs.size) throw Error('请先停止采集或邀约任务，再安装更新')
        await saveBeforeExit()
        installingUpdate = true
        closing = true
      },
    })
    handle('update-state', () => updates.state, false)
    handle('update-check', () => updates.check(), false)
    handle('update-download', () => updates.download(), false)
    handle('update-install', () => updates.install(), false)
    handle('license-verify', () => license.verify(), false)
    handle('license-state', () => license.state, false)
    handle('license-activate', (code) => license.activate(code), false)
    handle('initialize', () => data)
    handle('export-logs', exportLogs, false)
    handle('prepare-account', prepareAccount)
    handle('bind-guest', (id, guestId) => {
      const c = connections.get(id)
      const guest = webContents.fromId(guestId)
      if (
        !c ||
        guest?.hostWebContents !== window.webContents ||
        guest.session !== c.session
      )
        throw Error('账号与网页会话不匹配')
      if (c.contents === guest) return refreshAccount(id)
      c.contents = guest
      guest.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('https://'))
          guest.loadURL(url).catch((error) => {
            if (error.code !== 'ERR_ABORTED')
              reportError('打开平台页面失败', error, id)
          })
        return { action: 'deny' }
      })
      guest.on('did-fail-load', (_event, code, description, url, mainFrame) => {
        if (mainFrame && code !== -3)
          reportError(
            '平台网页加载失败',
            Object.assign(Error(`${description}（${code}）`), {
              response: { path: url.split('?')[0], code },
            }),
            id
          )
      })
      guest.on('render-process-gone', (_event, details) => {
        runner.stop(id)
        reportError(
          '平台网页进程退出',
          Error(`${details.reason}（${details.exitCode}）`),
          id
        )
      })
      guest.on('did-finish-load', () =>
        refreshAccount(id).catch((error) =>
          reportError('刷新账号失败', error, id)
        )
      )
      return refreshAccount(id)
    })
    handle('refresh-account', refreshAccount)
    handle('collect', (id) => runner.collect(id))
    handle('start', (id, config, talentIds) =>
      runner.start(id, config, talentIds)
    )
    handle('stop', (id) => runner.stop(id), false)
    handle('resolve-record', async (id, sent) => {
      const record = data.records.find((r) => r.id === id)
      if (!record || record.status !== 'review')
        throw Error('只有待核实记录可以确认结果')
      const previous = { ...record }
      record.status = sent ? 'success' : 'skipped'
      record.note = sent ? '人工确认已邀约' : '人工确认未邀约'
      record.resolution = new Date().toISOString()
      try {
        await save()
      } catch (error) {
        Object.assign(record, previous)
        if (!previous.resolution) delete record.resolution
        throw error
      }
      emit()
    })
    handle('remove-account', async (id, platform) => {
      if (!/^[\w-]+$/.test(id) || !Object.hasOwn(urls, platform))
        throw Error('无效账号')
      if (runner.jobs.has(id)) throw Error('请先停止该账号的任务')
      const c = connections.get(id)
      if (c) {
        clearTimeout(c.saveTimer)
        c.session.cookies.removeAllListeners('changed')
        await c.cookieSave
        if (c.contents && !c.contents.isDestroyed()) c.contents.close()
        connections.delete(id)
      }
      await session
        .fromPartition(`persist:${platform}:${id}`)
        .clearStorageData()
      await rm(path.join(directory, `${id}.cookies`), { force: true })
    })

    window = new BrowserWindow({
      width: 1440,
      height: 940,
      minWidth: 1100,
      minHeight: 760,
      title: '大懒虫',
      icon: path.join(root, '../assets/icons/icon-256.png'),
      backgroundColor: '#ffffff',
      webPreferences: {
        preload: path.join(root, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: true,
      },
    })
    window.webContents.on('will-attach-webview', (event, prefs, params) => {
      const match = /^persist:(kuaishou|douyin):([\w-]+)$/.exec(
        params.partition
      )
      if (
        !license.state.valid ||
        !match ||
        !connections.has(match[2]) ||
        params.src !== urls[match[1]]
      ) {
        event.preventDefault()
        return
      }
      delete prefs.preload
      prefs.nodeIntegration = false
      prefs.contextIsolation = true
      prefs.sandbox = true
      prefs.backgroundThrottling = false
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: '大懒虫',
          submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }],
        },
        { role: 'editMenu' },
        {
          label: '显示',
          submenu: [
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'toggleDevTools' },
            {
              label: '导出错误日志',
              click: () =>
                exportLogs().catch((error) => {
                  reportError('导出错误日志失败', error)
                  send({ type: 'error', message: error.message })
                }),
            },
          ],
        },
      ])
    )
    if (process.env.VITE_DEV_SERVER_URL)
      await window.loadURL(process.env.VITE_DEV_SERVER_URL)
    else await window.loadFile(path.join(root, '../dist/index.html'))
    setTimeout(() => updates.check(), 5000).unref()
    window.on('close', (event) => {
      if (closing) return
      event.preventDefault()
      closing = true
      const finish = async () => {
        for (const id of runner.jobs.keys()) runner.stop(id)
        await Promise.all([...runner.jobs.values()].map((j) => j.promise))
        await saveBeforeExit()
      }
      finish()
        .then(() => app.quit())
        .catch((error) => {
          closing = false
          reportError('退出时保存失败', error)
          send({ type: 'error', message: `保存未完成：${error.message}` })
        })
    })
    app.on('window-all-closed', () => app.quit())
  })
  .catch((error) => {
    console.error(error)
    diagnostics?.record({
      level: 'error',
      message: `启动失败：${error.message}`,
    })
    app.exit(1)
  })
