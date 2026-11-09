/**
 * AI module map
 * Purpose: orchestrate the trusted UI's native bridge, account connections, persistence,
 * platform observations, invitation runner, diagnostics, licensing, and update handoff.
 * Entry: createRuntime receives invoke/listen and optional preference storage, then
 * returns the DesktopBridge contract declared in commerce/desktop.ts.
 * Flow: initialize subscribes/loads data, restores interrupted work conservatively, and
 * constructs InviteRunner. Browser observations update account identity, quota,
 * and capture state; quota is observed from platform traffic only, never actively queried
 * or used to gate invitation startup. Observations are dated and cleared after a send,
 * identity loss/change, or quota failure. The send response owns invitation-limit decisions.
 * makeApi routes actual requests through platform_eval. License verification belongs
 * only to the native ten-minute monitor; UI operations read its latest result.
 * State: per-account connections/preparations, replayed UI events, save/log promise chains,
 * and license/update flags live in this closure rather than in remote WebViews.
 * Runtime events contain changed domains only; task events carry one account/kind task.
 * Task maps use accountId:kind keys. Collection and invitation run independently;
 * API cancellation checks that kind while native page locks aggregate both jobs.
 * Page errors stop collection; invitation requests retain their timed retry loop.
 * Subscribers share detached read-only snapshots. Replay merges domains and tasks so
 * late subscribers receive complete current data without changing other task references.
 * Initialization loads native data once; later UI hydration uses current replay and
 * preferences instead of retaining the startup task snapshot. Account removal releases
 * its live tasks after native view/preferences saving; database history is retained.
 * A confirmed Douyin login transition enters the account's talent home once; later
 * identity refreshes leave normal page navigation and browser history under user control.
 * Collection has one current-page list capture. Route changes and new list requests
 * invalidate it; an accepted response alone makes collection available again. SPA route
 * changes keep page readiness because they do not emit a new document-load completion.
 * CSV exports forward caller-selected content to the native save dialog and return its
 * saved/cancelled result; callers own the visible progress and completion messages.
 * SQLite owns durable history and activity. The UI retains bounded task logs and
 * page queries; changed rows and progress replace complete-history snapshots.
 * Collected talents remain owned by sourceAccountId; deletion and running-job locks use
 * that account scope so another account's collection is never affected.
 * Invariants: record commits precede uncertain sends; stale or self-originated responses
 * cannot replace current filters. Invalid licensing stops jobs; updating blocks new jobs
 * and drains existing work before native installation. Sanitize diagnostics at the boundary.
 */

import {
  apiError,
  classifyObservedRequest,
  interpretObservedResponse,
  makeApi,
  urls,
} from './platform.mjs'
import { InviteRunner } from './runner.mjs'

function nativeError(value) {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null)
    return Object.assign(Error(value.message || value.error), value)
  return Error(String(value))
}

const preferencesKey = 'ecommerce-assistant-local-v1'

// Only the trusted local UI owns this object. Platform fetches run in their
// account WebView through Rust, which checks authorization and task state.
export function createRuntime(
  invoke,
  listen,
  storage = globalThis.localStorage
) {
  const listeners = new Set()
  const replay = new Map()
  const connections = new Map()
  const preparations = new Map()
  let data
  let runner
  let initialization
  let licenseValid = false
  let updating = false
  let saveChain = Promise.resolve()
  let logChain = Promise.resolve()
  let preferenceText
  let cachedPreferences = {}
  let committedPreferences = {}
  let restoredPreferences = {}

  const call = async (command, args) => {
    try {
      return await invoke(command, args)
    } catch (error) {
      throw nativeError(error)
    }
  }
  const send = (event) => {
    // Detach once from the mutable runner, not once per UI subscriber. Consumers
    // only read these snapshots; unchanged domains retain their UI references.
    const snapshot = structuredClone(event)
    const key =
      event.type === 'account' || event.type === 'capture'
        ? `${event.type}:${event.id}`
        : event.type
    if (event.type === 'task') {
      const previous = replay.get('runtime')
      replay.set('runtime', {
        type: 'runtime',
        data: {
          ...previous?.data,
          tasks: {
            ...previous?.data.tasks,
            [`${snapshot.task.accountId}:${snapshot.task.kind}`]: snapshot.task,
          },
        },
      })
    } else if (event.type === 'account') {
      const previous = replay.get(key)
      replay.set(key, {
        ...snapshot,
        patch: { ...previous?.patch, ...snapshot.patch },
      })
    } else if (event.type === 'runtime') {
      // Account/config hydration is sent once, not retained as an old copy that
      // could overwrite later local edits when a listener subscribes again.
      const {
        accounts: _accounts, configs: _configs, filters: _filters,
        selected: _selected, ...runtimeData
      } = snapshot.data
      replay.set(key, {
        ...snapshot,
        data: { ...replay.get(key)?.data, ...runtimeData },
      })
    } else if (event.type !== 'error') replay.set(key, snapshot)
    for (const listener of listeners) listener(snapshot)
    return snapshot
  }
  const invalidate = () => {
    if (!data) return
    data.dataRevision++
    send({ type: 'runtime', data: {
      dataRevision: data.dataRevision,
      talentCounts: data.talentCounts,
    } })
  }
  const emit = (...fields) => {
    const visible = fields.filter((field) => !['talents', 'records', 'collections'].includes(field))
    if (visible.length) send({
      type: 'runtime',
      data: Object.fromEntries(visible.map((field) => [field, data[field]])),
    })
    if (fields.some((field) => ['talents', 'records', 'collections', 'logs'].includes(field))) invalidate()
  }
  const emitTask = (task, ...fields) => {
    send({ type: 'task', task })
    if (fields.length) emit(...fields)
  }
  const preferences = () => {
    const raw = storage?.getItem(preferencesKey)
    if (raw === preferenceText) return cachedPreferences
    preferenceText = raw
    if (raw) {
      const { accounts, configs, filters, selected } = JSON.parse(raw).state
      cachedPreferences = { accounts, configs, filters, selected }
    } else cachedPreferences = {}
    return cachedPreferences
  }
  // Only changed rows cross IPC. The parsed preference references stay stable
  // until localStorage changes. Read them when the queued write starts, not when
  // it is enqueued. Account removal publishes its committed preference change
  // synchronously before this queue item releases the next write.
  const save = (changes = {}, preferenceOverrides, afterCommit) => {
    const tasks = changes.tasks || data.tasks
    const snapshot = structuredClone({
      ...changes,
      tasks: Object.fromEntries(Object.entries(tasks).map(([id, task]) => {
        const { activity: _activity, logs: _logs, ...summary } = task
        return [id, summary]
      })),
    })
    const pending = saveChain.then(async () => {
      const currentPreferences = { ...preferences(), ...preferenceOverrides?.() }
      const changedPreferences = Object.fromEntries(
        Object.entries(currentPreferences).filter(([key, value]) =>
          value !== committedPreferences[key]
        )
      )
      if (Object.keys(changedPreferences).length)
        snapshot.preferences = structuredClone(changedPreferences)
      const result = await call('runtime_save', { data: snapshot })
      committedPreferences = currentPreferences
      if (snapshot.talents?.length) {
        const accountId = snapshot.talents[0].sourceAccountId
        data.talentCounts = {
          ...data.talentCounts,
          [accountId]: (data.talentCounts[accountId] || 0) + result.added,
        }
      }
      afterCommit?.()
      return result
    })
    saveChain = pending.catch(() => {})
    return pending
  }
  const query = (request) => call('database_query', { request })
  const deleteData = async (request) => {
    await initialize()
    requireLicense()
    await saveChain
    if (request.kind === 'logs') {
      await logChain
      request = { ...request, before: new Date().toISOString() }
    }
    await call('database_delete', { request })
    if (request.kind === 'talents') data.talentCounts = await query({ kind: 'counts' })
    if (request.kind === 'logs') {
      const matches = (entry) => entry.time <= request.before &&
        (!request.platform || request.platform === 'all' || !entry.platform || entry.platform === request.platform) &&
        (!request.accountId || request.accountId === 'all' || entry.accountId === request.accountId)
      data.logs = data.logs.filter((entry) => !matches(entry))
      const accounts = preferences().accounts || []
      for (const task of Object.values(data.tasks)) {
        const platform = accounts.find((account) => account.id === task.accountId)?.platform
        const logs = task.logs.filter((entry) => !matches({ ...entry, accountId: task.accountId, platform }))
        if (logs.length !== task.logs.length) {
          task.logs = logs
          emitTask(task)
        }
      }
      emit('logs')
    } else invalidate()
  }
  const log = (entry) => {
    if (entry.level !== 'error') return
    const safe = apiError(
      entry.response?.path || 'runtime',
      entry.response?.method,
      entry.message,
      entry.response || {}
    )
    const item = {
      ...entry,
      id: crypto.randomUUID(),
      time: entry.time || new Date().toISOString(),
      message: safe.message,
      ...(entry.response ? { response: safe.response } : {}),
    }
    if (data) {
      data.logs.push(item)
      data.logs = data.logs.slice(-1000)
    }
    logChain = logChain
      .then(() => call('diagnostic_append', { entry: item }))
      .then(() => { if (data) emit('logs') })
      .catch((error) => {
        send({ type: 'error', message: `错误日志保存失败：${error.message}` })
      })
  }
  const report = (context, error, accountId) =>
    log({
      level: 'error',
      message: `${context}：${error.message}`,
      accountId,
      platform: connections.get(accountId)?.platform,
      response: error.response,
    })
  const action = async (context, operation, accountId) => {
    try {
      await listening
      return await operation()
    } catch (error) {
      if (!error.logged) report(context, error, accountId)
      throw error
    }
  }
  const requireLicense = () => {
    if (!licenseValid)
      throw Object.assign(Error(replay.get('license')?.state.message || '授权无效'), {
        beforeSend: true,
      })
  }
  const emptyQuota = {
    quota: null,
    limit: null,
    quotaRows: [],
    quotaObservedAt: '',
    quotaError: '',
  }
  const clearQuota = (c, patch = {}) => {
    // One account-wide slot covers both the workspace and login WebView, so an
    // earlier in-flight response cannot restore a value invalidated by a send/login.
    c.latest.delete('quota')
    send({ type: 'account', id: c.id, patch: { ...emptyQuota, ...patch } })
  }
  const onQuota = (id, quota) => {
    send({
      type: 'account',
      id,
      patch: {
        status: 'online',
        quotaError: '',
        quota: quota.remaining,
        limit: quota.limit,
        quotaRows: quota.rows,
        quotaObservedAt: new Date().toISOString(),
      },
    })
  }
  const clearCapture = (c) => {
    c.capture = {}
    send({ type: 'capture', id: c.id, ready: false })
  }
  const expireAccount = (c, message) => {
    if (runner?.hasJobs(c.id))
      void runner
        .stop(c.id)
        .catch((error) => report('停止任务失败', error, c.id))
    c.online = false
    c.latest.delete('list')
    clearCapture(c)
    clearQuota(c, { status: 'expired', quotaError: message })
  }
  const platformApi = (c, kind) =>
    makeApi(
      {
        getURL: () => c.url,
        executeJavaScript: async (script, request) => {
          if (runner.jobs.get(`${c.id}:${kind}`)?.stopped)
            throw Object.assign(Error('已停止'), { beforeSend: true })
          const sending = kind === 'invite' && (
            request.path === '/distribute/pc/seller/invite/seller/create' ||
            request.path === '/connection/pc/im/invite/card/send'
          )
          try {
            const result = await call('platform_eval', {
              accountId: c.id,
              script,
              task: true,
              request,
            })
            if (sending && !result.beforeSend) clearQuota(c)
            return result
          } catch (error) {
            if (sending && !error.beforeSend) clearQuota(c)
            throw error
          }
        },
      },
      c.platform
    )
  const observe = (event) => {
    const c = connections.get(event.accountId)
    if (!c) return
    if (event.workspace && event.url) c.url = event.url
    if (event.type === 'route') {
      if (event.workspace) {
        clearCapture(c)
        c.latest.delete('list')
      }
      return
    }
    if (event.type === 'navigation') {
      if (event.workspace) {
        c.ready = false
        clearCapture(c)
        c.latest.delete('list')
      }
      return
    }
    if (event.type === 'ready') {
      if (event.workspace) c.ready = true
      return
    }
    const request = event.request
    if (!request) {
      if (event.type === 'error') {
        if (event.workspace) {
          c.ready = false
          clearCapture(c)
          // Invitation requests wait and retry when the page becomes available.
          // Collection still depends on the current page capture and must stop.
          void runner
            ?.stop(c.id, 'collect')
            .catch((error) => report('停止任务失败', error, c.id))
        }
        report('平台网页异常', nativeError(event.error), c.id)
      }
      return
    }
    // Rust assigns order across both account WebViews; the page bridge already
    // excludes task-owned requests and older requests in the same document.
    if (!licenseValid) return
    if (!event.workspace && request.kind === 'list') return
    if (request.phase === 'pending') {
      c.latest.set(request.kind, request.order)
      if (request.kind === 'list') clearCapture(c)
      return
    }
    if (c.latest.get(request.kind) !== request.order) return
    if (
      ['account', 'quota'].includes(request.kind) &&
      request.order < c.identityOrder
    )
      return
    try {
      if (event.error) throw apiError(request.path, request.method, event.error)
      const observed = classifyObservedRequest(
        c.platform,
        request.url,
        request.body,
        request.pageUrl
      )
      if (!observed) return
      const result = interpretObservedResponse(
        c.platform,
        { ...observed, method: request.method, pageUrl: request.pageUrl },
        event.response.text,
        event.response
      )
      if (result.capture) {
        c.capture.list = result.capture
        send({ type: 'capture', id: c.id, ready: Boolean(c.capture.list) })
      }
      if (result.quota) onQuota(c.id, result.quota)
      if (result.account) {
        c.identityOrder = request.order
        const changed =
          c.shopId &&
          result.account.shopId &&
          c.shopId !== result.account.shopId
        if (changed || result.account.status !== 'online') {
          c.latest.delete('list')
          clearCapture(c)
          clearQuota(c)
          if (runner?.hasJobs(c.id)) {
            void runner
              .stop(c.id)
              .catch((error) => report('停止任务失败', error, c.id))
            report(
              '任务已停止',
              Error(changed ? '平台网页切换了登录账号' : '平台账号已退出登录'),
              c.id
            )
          }
        }
        if (result.account.shopId) c.shopId = result.account.shopId
        const online = result.account.status === 'online'
        const becameOnline = online && !c.online
        c.online = online
        send({
          type: 'account',
          id: c.id,
          patch: result.account,
        })
        if (online && !event.workspace && c.closeOnLogin) {
          c.closeOnLogin = false
          c.ready = false
          void call('browser_finish_login', { accountId: c.id })
            .then(() => save())
            .catch((error) => report('完成账号登录失败', error, c.id))
        } else if (
          becameOnline &&
          event.workspace &&
          c.platform === 'douyin' &&
          !runner.hasJobs(c.id) &&
          new URL(c.url).pathname !== new URL(urls.douyin).pathname
        ) {
          // Consume the login transition before navigating: getUser also runs on
          // the destination and during later browsing, and must not cause a loop.
          c.ready = false
          void call('browser_navigate', { accountId: c.id })
            .then(() => save())
            .catch((error) => report('打开达人邀约主页失败', error, c.id))
        }
      }
    } catch (error) {
      report('读取平台网页数据失败', error, c.id)
      if (error.login) {
        c.identityOrder = request.order
        expireAccount(c, error.message)
      } else if (request.kind === 'quota') clearQuota(c, { quotaError: error.message })
      if (event.workspace && request.kind === 'list')
        send({ type: 'error', message: error.message })
    }
  }

  const listening = Promise.all([
    listen('assistant:event', ({ payload }) => {
      if (payload.type === 'database') {
        invalidate()
        return
      }
      if (payload.type === 'license') {
        licenseValid = payload.state.valid
        // Stop on native license loss; LicenseGate exits the UI while task cleanup retains persisted results.
        if (!licenseValid && runner)
          for (const id of new Set([...runner.jobs.values()].map((job) => job.accountId)))
            void runner
              .stop(id)
              .catch((error) => report('停止任务失败', error, id))
      }
      send(payload)
      if (payload.type === 'account' && data)
        void save().catch((error) => report('保存账号失败', error, payload.id))
    }),
    listen('assistant:browser', ({ payload }) => observe(payload)),
  ])
  // Keep initialization failures observable by every public operation without
  // leaving the eagerly registered listeners' Promise unhandled.
  void listening.catch(() => {})

  const initialize = () => {
    if (initialization) return initialization
    initialization = action('读取运行数据失败', async () => {
      data = await call('runtime_load')
      data.dataRevision = 0
      data.talents = []
      data.records = []
      data.collections = []
      const local = preferences()
      // Imported native preferences seed the existing Zustand store only when
      // its new WebView has no accounts yet. Never replay old online status.
      const restored = {}
      const nativePreferences = !local.accounts?.length && data.accounts?.length
      for (const key of ['accounts', 'configs', 'filters', 'selected']) {
        if (
          (local[key] === undefined || nativePreferences) &&
          data[key] !== undefined
        )
          restored[key] = data[key]
      }
      if (local.accounts?.length) restored.accounts = local.accounts
      if (restored.accounts)
        restored.accounts = restored.accounts.map((account) => ({
          ...account,
          status: 'offline',
          ...emptyQuota,
        }))
      restoredPreferences = restored
      // Native initialization recovers durable sending rows as manual review.
      for (const task of Object.values(data.tasks)) {
        task.logs = (task.logs || []).filter((entry) => entry.level === 'error')
        if (task.status === 'running') {
          task.status = 'stopped'
          task.current = '上次任务已中断'
          await call('set_task_state', {
            accountId: task.accountId,
            running: false,
            collecting: false,
          })
          log({
            level: 'error',
            accountId: task.accountId,
            taskId: task.startedAt,
            kind: task.kind,
            message: '上次任务意外中断，请检查采集列表或待核实记录',
          })
        }
      }
      runner = new InviteRunner({
        data,
        save,
        query,
        emit: emitTask,
        onLog: log,
        onTaskState: (accountId, running, collecting) =>
          call('set_task_state', {
            accountId,
            running,
            collecting,
          }),
        getConnection: (id, kind) => {
          const c = connections.get(id)
          if (!c?.ready) throw Error('请先打开该账号的邀约网页')
          const api = platformApi(c, kind)
          return {
            platform: c.platform,
            url: c.url,
            capture: c.capture,
            api: async (...args) => {
              try {
                return await api(...args)
              } catch (error) {
                if (error.login) expireAccount(c, error.message)
                throw error
              }
            },
          }
        },
      })
      const result = {
        dataRevision: data.dataRevision,
        talentCounts: data.talentCounts,
        logs: data.logs,
        talents: data.talents,
        records: data.records,
        tasks: data.tasks,
        collections: data.collections,
        ...restored,
      }
      send({ type: 'runtime', data: result })
      await save()
    }).catch((error) => {
      initialization = undefined
      throw error
    })
    return initialization
  }

  const prepareAccount = (account) =>
    action(
      '准备账号失败',
      async () => {
        await initialize()
        if (connections.has(account.id)) return preparations.get(account.id)
        const c = {
          ...account,
          url: 'about:blank',
          ready: false,
          capture: {},
          latest: new Map(),
          identityOrder: 0,
          shopId: account.shopId || '',
          online: false,
          closeOnLogin: false,
        }
        connections.set(account.id, c)
        clearQuota(c, { status: 'offline' })
        const pending = call('browser_prepare', { account })
          .then(async (result) => {
            if (c.url === 'about:blank') c.url = result.url
            await save()
          })
          .catch((error) => {
            connections.delete(account.id)
            throw error
          })
          .finally(() => preparations.delete(account.id))
        preparations.set(account.id, pending)
        await pending
      },
      account.id
    )

  return {
    initialize: async () => {
      await initialize()
      // License recovery can hydrate the UI again. Reusing the first returned
      // snapshot would restore old tasks, account names and database revisions.
      return {
        ...restoredPreferences,
        ...preferences(),
        ...replay.get('runtime').data,
      }
    },
    getLicenseState: () =>
      action('读取授权失败', async () => {
        const previous = replay.get('license')
        const state = await call('license_state')
        // A monitor event received during this read is newer than the IPC snapshot.
        const latest = replay.get('license')
        if (latest !== previous) return latest.state
        licenseValid = state.valid
        send({ type: 'license', state })
        return state
      }),
    activateLicense: (code) =>
      action('激活失败', async () => {
        const result = await call('license_activate', { code })
        const state = await call('license_state')
        licenseValid = state.valid
        send({ type: 'license', state })
        return result
      }),
    getUpdateState: () => action('读取更新失败', () => call('update_state')),
    checkForUpdates: () => action('检查更新失败', () => call('update_check')),
    applyUpdate: (beforeInstall) =>
      action('更新失败', async () => {
        if (updating) throw Error('正在更新，请稍候')
        updating = true
        try {
          const state = await call('update_download')
          if (state.status === 'error') return state
          if (runner?.jobs.size) {
            await new Promise((resolve) => {
              const onFinished = () => {
                if (runner.jobs.size) return
                listeners.delete(onFinished)
                resolve()
              }
              listeners.add(onFinished)
            })
          }
          // Invitation callers may flush their own state here. Native update_install
          // drains every account's Chromium engine before enforcing task exclusion.
          await beforeInstall?.()
          if (data) await save()
          await logChain
          return await call('update_install')
        } finally {
          updating = false
        }
      }),
    exportCsv: (filename, content) =>
      action('导出 CSV 失败', () => call('export_csv', { filename, content })),
    exportLogs: (accountId) =>
      action(
        '导出错误日志失败',
        async () => {
          await logChain
          return call('diagnostic_export', { accountId })
        },
        accountId
      ),
    clearLogs: (platform, accountId) =>
      action('清空日志失败', () => deleteData({ kind: 'logs', platform, accountId })),
    queryData: async (request) => {
      await initialize()
      return query(request)
    },
    deleteData: (request) => action('删除数据失败', () => deleteData(request)),
    exportData: (request) => action('导出数据失败', async () => {
      await initialize()
      await save()
      if (request.kind === 'logs') await logChain
      return call('database_export', { request })
    }),
    clearTalents: (platform, accountId, ids) =>
      action('删除采集达人失败', () => deleteData({ kind: 'talents', platform, accountId, ...(ids === undefined ? {} : { ids }) })),
    clearRecords: (ids) =>
      action('清空邀约记录失败', () => deleteData({ kind: 'records', ids })),
    prepareAccount,
    openAccountLogin: (account, closeOnLogin = true) =>
      action(
        '打开登录窗口失败',
        async () => {
          await prepareAccount(account)
          if (runner.hasJobs(account.id))
            throw Error('请先停止该账号的任务，再打开登录窗口')
          const c = connections.get(account.id)
          c.closeOnLogin = closeOnLogin
          clearQuota(c)
          try {
            await call('browser_login', { account })
          } catch (error) {
            c.closeOnLogin = false
            throw error
          }
        },
        account.id
      ),
    removeAccount: (accountId, platform) =>
      action(
        '移除账号失败',
        async () => {
          await initialize()
          if (runner.hasJobs(accountId)) throw Error('请先停止该账号的任务')
          if (!connections.has(accountId))
            await prepareAccount({ id: accountId, platform })
          await call('browser_remove', { accountId })
          connections.delete(accountId)
          replay.delete(`account:${accountId}`)
          replay.delete(`capture:${accountId}`)
          const remainingPreferences = () => {
            const current = preferences()
            const accounts = (current.accounts || data.accounts || [])
              .filter((account) => account.id !== accountId)
            const configs = { ...(current.configs || data.configs || {}) }
            const filters = { ...(current.filters || data.filters || {}) }
            delete configs[accountId]
            delete filters[accountId]
            return { accounts, configs, filters }
          }
          await save({}, remainingPreferences, () => {
            // Other accounts can change during native IPC. Remove only this ID
            // from the latest UI preferences before the next queued save reads them.
            const remaining = remainingPreferences()
            Object.assign(data, remaining)
            restoredPreferences = { ...restoredPreferences, ...remaining }
            delete data.tasks[`${accountId}:collect`]
            delete data.tasks[`${accountId}:invite`]
            // Replay already owns detached tasks; retain other task references.
            const previous = replay.get('runtime')
            const tasks = { ...previous.data.tasks }
            delete tasks[`${accountId}:collect`]
            delete tasks[`${accountId}:invite`]
            const event = { type: 'runtime', data: { ...remaining, tasks } }
            replay.set('runtime', {
              type: 'runtime',
              data: { ...previous.data, tasks },
            })
            for (const listener of listeners) listener(event)
            invalidate()
          })
        },
        accountId
      ),
    collect: (accountId) =>
      action(
        '启动采集失败',
        async () => {
          await initialize()
          if (updating) throw Error('正在更新，暂不能启动采集')
          await runner.collect(accountId)
        },
        accountId
      ),
    start: (accountId, config, talentIds) => {
      const snapshot = structuredClone({ config, talentIds })
      return action(
        '启动邀约失败',
        async () => {
          await initialize()
          if (updating) throw Error('正在更新，暂不能启动邀约')
          await runner.start(accountId, snapshot.config, snapshot.talentIds)
        },
        accountId
      )
    },
    stop: (accountId, kind) =>
      action(
        '停止任务失败',
        async () => {
          // Stop never loads protected data or verifies a license.
          if (runner) await runner.stop(accountId, kind)
          else await call('set_task_state', { accountId, running: false, collecting: false })
        },
        accountId
      ),
    resolveRecord: (id, sent) =>
      action('核实邀约记录失败', async () => {
        await initialize()
        requireLicense()
        const record = await query({ kind: 'record', id })
        if (!record || record.status !== 'review')
          throw Error('只有待核实记录可以确认结果')
        if (runner.hasJobs(record.accountId)) throw Error('请先停止该账号的任务')
        record.status = sent ? 'success' : 'skipped'
        record.note = sent ? '人工确认已邀约' : '人工确认未邀约'
        record.resolution = new Date().toISOString()
        await save({ records: [record] })
        emit('records')
      }),
    onEvent: (listener) => {
      listeners.add(listener)
      queueMicrotask(() => {
        if (listeners.has(listener))
          for (const event of replay.values()) listener(event)
      })
      return () => listeners.delete(listener)
    },
  }
}
