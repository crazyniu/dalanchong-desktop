import {
  apiError,
  classifyObservedRequest,
  interpretObservedResponse,
  makeApi,
  readQuota,
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
  let saveChain = Promise.resolve()
  let logChain = Promise.resolve()

  const call = async (command, args) => {
    try {
      return await invoke(command, args)
    } catch (error) {
      throw nativeError(error)
    }
  }
  const send = (event) => {
    const key =
      event.type === 'account' || event.type === 'capture'
        ? `${event.type}:${event.id}`
        : event.type
    if (event.type === 'account') {
      const previous = replay.get(key)
      replay.set(key, {
        ...event,
        patch: { ...previous?.patch, ...event.patch },
      })
    } else if (event.type !== 'error') replay.set(key, structuredClone(event))
    for (const listener of listeners) listener(structuredClone(event))
  }
  const emit = () => {
    // Preferences are hydrated once. Replaying persisted preferences on every
    // task tick would overwrite account edits made in the existing UI store.
    const { logs, talents, records, tasks, collections } = data
    send({
      type: 'runtime',
      data: { logs, talents, records, tasks, collections },
    })
  }
  const preferences = () => {
    const raw = storage?.getItem(preferencesKey)
    if (!raw) return {}
    const { accounts, configs, filters, selected } = JSON.parse(raw).state
    return { accounts, configs, filters, selected }
  }
  const save = (preferenceOverrides = {}) => {
    const snapshot = structuredClone({
      ...data,
      ...preferences(),
      ...preferenceOverrides,
    })
    const pending = saveChain.then(() =>
      call('runtime_save', { data: snapshot })
    )
    saveChain = pending.catch(() => {})
    return pending
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
      emit()
    }
    logChain = logChain
      .then(() => call('diagnostic_append', { entry: item }))
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
  const requireLicense = async () => {
    const state = await call('license_verify')
    licenseValid = state.valid
    send({ type: 'license', state })
    if (!state.valid)
      throw Object.assign(Error(state.message), { beforeSend: true })
    return state
  }
  const onQuota = (id, quota) => {
    connections.get(id).quotaAt = Date.now()
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
  const clearCapture = (c) => {
    c.capture = {}
    send({ type: 'capture', id: c.id, ready: false })
  }
  const expireAccount = (c, message) => {
    if (runner?.jobs.has(c.id))
      void runner
        .stop(c.id)
        .catch((error) => report('停止任务失败', error, c.id))
    c.quotaAt = 0
    c.identityRevision++
    c.latest.delete('search')
    c.latest.delete('promoter')
    clearCapture(c)
    send({
      type: 'account',
      id: c.id,
      patch: {
        status: 'expired',
        quotaError: message,
      },
    })
  }
  const platformApi = (c, task) =>
    makeApi(
      {
        getURL: () => c.url,
        executeJavaScript: async (script, request) => {
          if (task && runner.jobs.get(c.id)?.stopped)
            throw Object.assign(Error('已停止'), { beforeSend: true })
          return call('platform_eval', {
            accountId: c.id,
            script,
            task,
            request,
          })
        },
      },
      c.platform
    )
  const refresh = async (id, force = true) => {
    const c = connections.get(id)
    if (!c) throw Error('请先打开该账号的邀约网页')
    if (!c.ready) return
    if (new URL(c.url).origin !== new URL(urls[c.platform]).origin) return
    if (!force && Date.now() - c.quotaAt < 30_000) return
    if (c.refresh) return c.refresh
    const revision = c.identityRevision
    const quotaOrder = c.latest.get('quota')
    c.refresh = (async () => {
      try {
        const quota = await readQuota(platformApi(c, false), c.platform)
        if (
          connections.get(id) === c &&
          revision === c.identityRevision &&
          quotaOrder === c.latest.get('quota')
        )
          onQuota(id, quota)
      } catch (error) {
        if (
          connections.get(id) !== c ||
          revision !== c.identityRevision ||
          quotaOrder !== c.latest.get('quota')
        )
          return
        if (error.login) expireAccount(c, error.message)
        else send({ type: 'account', id, patch: { quotaError: error.message } })
        throw error
      }
    })().finally(() => {
      c.refresh = null
    })
    return c.refresh
  }

  const observe = (event) => {
    const c = connections.get(event.accountId)
    if (!c) return
    if (event.workspace && event.url) c.url = event.url
    if (event.type === 'navigation') {
      if (event.workspace) {
        c.ready = false
        c.identityRevision++
        clearCapture(c)
        c.latest.delete('search')
        c.latest.delete('promoter')
      }
      return
    }
    if (event.type === 'ready') {
      if (event.workspace) {
        c.ready = true
        if (licenseValid)
          void (c.refresh || Promise.resolve())
            .then(() => refresh(c.id, false))
            .catch((error) => report('刷新账号失败', error, c.id))
      }
      return
    }
    const request = event.request
    if (!request) {
      if (event.type === 'error') {
        if (event.workspace) {
          c.ready = false
          clearCapture(c)
          void runner
            ?.stop(c.id)
            .catch((error) => report('停止任务失败', error, c.id))
        }
        report('平台网页异常', nativeError(event.error), c.id)
      }
      return
    }
    // Rust assigns order across both account WebViews; the page bridge already
    // excludes task-owned requests and older requests in the same document.
    if (!licenseValid) return
    if (
      !event.workspace &&
      ['search', 'promoter', 'product'].includes(request.kind)
    )
      return
    if (request.phase === 'pending') {
      c.latest.set(request.kind, request.order)
      if (request.kind === 'search') clearCapture(c)
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
        request.body
      )
      if (!observed) return
      const result = interpretObservedResponse(
        c.platform,
        { ...observed, method: request.method },
        event.response.text,
        event.response
      )
      if (result.capture) {
        c.capture[result.capture.kind] = result.capture
        send({ type: 'capture', id: c.id, ready: Boolean(c.capture.search) })
      }
      if (result.quota) onQuota(c.id, result.quota)
      if (result.account) {
        c.identityOrder = request.order
        // A confirmed identity supersedes quota requests from the previous session.
        c.identityRevision++
        const changed =
          c.shopId &&
          result.account.shopId &&
          c.shopId !== result.account.shopId
        if (changed || result.account.status !== 'online') {
          c.latest.delete('search')
          c.latest.delete('promoter')
          c.quotaAt = 0
          clearCapture(c)
          if (runner?.jobs.has(c.id)) {
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
        send({
          type: 'account',
          id: c.id,
          patch: { ...result.account, ...(online ? { quotaError: '' } : {}) },
        })
        if (online && !event.workspace && c.closeOnLogin) {
          c.closeOnLogin = false
          c.ready = false
          c.quotaAt = 0
          void call('browser_finish_login', { accountId: c.id })
            .then(() => save())
            .catch((error) => report('完成账号登录失败', error, c.id))
        } else if (online && c.ready)
          void (c.refresh || Promise.resolve())
            .then(() => refresh(c.id, false))
            .catch((error) => report('刷新账号失败', error, c.id))
      }
    } catch (error) {
      report('读取平台网页数据失败', error, c.id)
      if (error.login) {
        c.identityOrder = request.order
        expireAccount(c, error.message)
      }
      if (event.workspace && request.kind === 'search')
        send({ type: 'error', message: error.message })
    }
  }

  const listening = Promise.all([
    listen('assistant:event', ({ payload }) => {
      if (payload.type === 'license') {
        licenseValid = payload.state.valid
        if (!licenseValid && runner)
          for (const id of runner.jobs.keys())
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
      await requireLicense()
      data = await call('runtime_load')
      data.talents ??= []
      data.records ??= []
      data.tasks ??= {}
      data.collections ??= []
      data.logs = (data.logs || []).filter((entry) => entry.level === 'error')
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
          quotaError: '',
        }))
      for (const record of data.records) {
        if (record.status === 'sending') {
          record.status = 'review'
          record.note = '上次发送未保存最终结果，请在平台核实'
        }
      }
      for (const task of Object.values(data.tasks)) {
        task.logs = (task.logs || []).filter((entry) => entry.level === 'error')
        if (task.status === 'running') {
          task.status = 'stopped'
          task.current = '上次任务已中断'
          await call('set_task_state', {
            accountId: task.accountId,
            running: false,
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
        emit,
        onQuota,
        onLog: log,
        onTaskState: (accountId, running) =>
          call('set_task_state', { accountId, running }),
        getConnection: (id) => {
          const c = connections.get(id)
          if (!c?.ready) throw Error('请先打开该账号的邀约网页')
          const api = platformApi(c, true)
          return {
            platform: c.platform,
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
        logs: data.logs,
        talents: data.talents,
        records: data.records,
        tasks: data.tasks,
        collections: data.collections,
        ...restored,
      }
      send({ type: 'runtime', data: result })
      await save()
      return structuredClone(result)
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
          identityRevision: 0,
          quotaAt: 0,
          shopId: '',
          refresh: null,
          closeOnLogin: false,
        }
        connections.set(account.id, c)
        send({
          type: 'account',
          id: account.id,
          patch: { status: 'offline', quotaError: '' },
        })
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
    initialize,
    getLicenseState: () => action('读取授权失败', () => call('license_state')),
    verifyLicense: () =>
      action('验证授权失败', async () => {
        const state = await call('license_verify')
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
    downloadUpdate: () => action('下载更新失败', () => call('update_download')),
    installUpdate: () =>
      action('安装更新失败', async () => {
        if (runner?.jobs.size) throw Error('请先停止采集或邀约任务，再安装更新')
        if (data) await save()
        await logChain
        return call('update_install')
      }),
    exportLogs: () =>
      action('导出错误日志失败', async () => {
        await logChain
        return call('diagnostic_export')
      }),
    clearLogs: (platform, accountId) =>
      action('清空日志失败', async () => {
        await initialize()
        await requireLicense()
        const before = new Date().toISOString()
        const matches = (log) =>
          log.time <= before &&
          (platform === 'all' || !log.platform || log.platform === platform) &&
          (accountId === 'all' || log.accountId === accountId)
        const pending = logChain.then(() =>
          call('diagnostic_clear', {
            platform: platform === 'all' ? null : platform,
            accountId: accountId === 'all' ? null : accountId,
            before,
          })
        )
        logChain = pending.catch(() => {})
        await pending
        data.logs = data.logs.filter((log) => !matches(log))
        const accounts = preferences().accounts || data.accounts || []
        for (const [id, task] of Object.entries(data.tasks)) {
          if (
            (accountId === 'all' || id === accountId) &&
            (platform === 'all' ||
              accounts.find((a) => a.id === id)?.platform === platform)
          ) {
            task.logs = (task.logs || []).filter((log) => log.time > before)
          }
        }
        await save()
        emit()
      }),
    clearTalents: (platform, ids) =>
      action('删除采集达人失败', async () => {
        await initialize()
        await requireLicense()
        if ([...runner.jobs.values()].some((job) => job.platform === platform))
          throw Error('请先停止此平台的采集或邀约任务')
        const selected = new Set(ids)
        data.talents = data.talents.filter(
          (talent) =>
            talent.platform !== platform ||
            (ids !== undefined && !selected.has(talent.id))
        )
        await save()
        emit()
      }),
    clearRecords: (ids) =>
      action('清空邀约记录失败', async () => {
        await initialize()
        await requireLicense()
        const selected = new Set(ids)
        if (
          data.records.some(
            (record) =>
              selected.has(record.id) && runner.jobs.has(record.accountId)
          )
        )
          throw Error('请先停止相关账号的任务')
        data.records = data.records.filter((record) => !selected.has(record.id))
        await save()
        emit()
      }),
    prepareAccount,
    openAccountLogin: (account, closeOnLogin = true) =>
      action(
        '打开登录窗口失败',
        async () => {
          await prepareAccount(account)
          if (runner.jobs.has(account.id))
            throw Error('请先停止该账号的任务，再打开登录窗口')
          const c = connections.get(account.id)
          c.closeOnLogin = closeOnLogin
          try {
            await call('browser_login', { account })
          } catch (error) {
            c.closeOnLogin = false
            throw error
          }
        },
        account.id
      ),
    refreshAccount: (accountId) =>
      action('刷新账号失败', () => refresh(accountId), accountId),
    removeAccount: (accountId, platform) =>
      action(
        '移除账号失败',
        async () => {
          await initialize()
          if (runner.jobs.has(accountId)) throw Error('请先停止该账号的任务')
          if (!connections.has(accountId))
            await prepareAccount({ id: accountId, platform })
          await call('browser_remove', { accountId })
          connections.delete(accountId)
          replay.delete(`account:${accountId}`)
          replay.delete(`capture:${accountId}`)
          const accounts = (
            preferences().accounts ||
            data.accounts ||
            []
          ).filter((account) => account.id !== accountId)
          data.accounts = accounts
          await save({ accounts })
        },
        accountId
      ),
    collect: (accountId) =>
      action(
        '启动采集失败',
        async () => {
          await initialize()
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
          await runner.start(accountId, snapshot.config, snapshot.talentIds)
        },
        accountId
      )
    },
    stop: (accountId) =>
      action(
        '停止任务失败',
        async () => {
          // Stop never loads protected data or verifies a license.
          if (runner) await runner.stop(accountId)
          else await call('set_task_state', { accountId, running: false })
        },
        accountId
      ),
    resolveRecord: (id, sent) =>
      action('核实邀约记录失败', async () => {
        await initialize()
        await requireLicense()
        const record = data.records.find((item) => item.id === id)
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
      }),
    onEvent: (listener) => {
      listeners.add(listener)
      queueMicrotask(() => {
        if (listeners.has(listener))
          for (const event of replay.values()) listener(structuredClone(event))
      })
      return () => listeners.delete(listener)
    },
  }
}
