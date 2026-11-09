/**
 * AI module map
 * Purpose: execute per-account collection and invitation jobs over an injected API.
 * Entry: InviteRunner receives data/save/emit/connection callbacks; collect, start, and
 * stop are called by runtime.mjs. validateConfig and alreadyHandled encode shared rules.
 * Flow: snapshot filters/config/selected talents, register and save the task, pace work,
 * persist collection batches or invitation outcomes, then release native task state.
 * Collection keeps its delay after each API call; invitation intervals separate send
 * call starts only. Preflight, responses and persistence consume that interval naturally.
 * The first send has no timer delay. Quota availability is decided by the send response;
 * Kuaishou's contact fields are reused after a successful fetch, without quota checks.
 * State: jobs and task snapshots use accountId:kind keys, allowing one collection
 * and one invitation per account with independent cancellation and activity batches.
 * Native busy state aggregates both jobs; only an active collection masks the page.
 * SQLite owns talents,
 * records and logs; only current tasks and 200 queued candidates live in the runner.
 * invite_ids builds the queue from talents with no account-scoped invitation record;
 * every historical status blocks entry, without a date cutoff. Totals use that queue.
 * Collection upserts preserve account-scoped IDs through the database UID index.
 * Each invitation step commits its changed record and task; UI receives task updates
 * and database invalidations rather than full history arrays. Activity is persisted
 * to the log table and only its latest 200 entries remain in the visible task.
 * Invitation rows retain their own send response, or the final preflight response when
 * skipped; platform.mjs supplies redacted bodies. Quota replies never enter these rows.
 * Per-talent collection messages show names and insert/update results; IDs stay in data.
 * Collection snapshots the observed list parameters and shares its immutable response;
 * later observations replace captures rather than mutating a running job's response.
 * platform.mjs owns source traversal and pagination rules.
 * Invariants: save 'sending' before dispatch. Kuaishou sends are at least two seconds
 * apart. Both platforms retry failed preparation/send requests after ten seconds,
 * preserving longer configured send intervals and the same record without advancing
 * counts. Cancellation retains a dispatched record for review; unsent rows are removed.
 * beforeSend failures cannot be counted as sent; account switching must not mutate
 * a running job's captured input.
 */

import {
  collect,
  isSupportedCollectionPage,
  prepareInvite,
} from './platform.mjs'

export function validateConfig(platform, config) {
  const ids = [
    ...new Set(
      config.products
        .trim()
        .split(/[\s,，、;；]+/)
        .filter(Boolean)
    ),
  ]
  if (
    !ids.length ||
    ids.length > (platform === 'douyin' ? 5 : 100) ||
    ids.some((id) => !/^\d+$/.test(id))
  )
    throw Error('商品 ID 格式或数量不正确')
  const length = Array.from(config.message.trim()).length
  if (!length || (platform === 'douyin' && length > 150))
    throw Error('请填写有效邀约话术，抖音最多 150 字')
  if (platform === 'douyin' && !config.phone.trim() && !config.wechat.trim())
    throw Error('请填写手机号或微信号')
  const minimumInterval = platform === 'kuaishou' ? 2000 : 500
  if (
    !Number.isSafeInteger(config.interval) ||
    config.interval < minimumInterval ||
    config.interval > 60000
  )
    throw Error(`邀约间隔为 ${minimumInterval}–60000 毫秒`)
  if (
    config.maxInvites != null &&
    (!Number.isSafeInteger(config.maxInvites) || config.maxInvites < 1)
  )
    throw Error('本次邀约上限须为正整数')
}

export function alreadyHandled(records, accountId, platform, talentId) {
  return records.some(
    (r) =>
      r.accountId === accountId &&
      r.platform === platform &&
      r.talentId === talentId
  )
}

async function waitUntil(nextAt, job) {
  const wait = nextAt - Date.now()
  if (wait > 0 && !job.stopped) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, wait)
      job.wake = () => {
        clearTimeout(timer)
        resolve()
      }
    })
    job.wake = null
  }
  if (job.stopped) throw Object.assign(Error('已停止'), { beforeSend: true })
}

function pacedRequest(api, interval, job) {
  let nextAt = 0
  return async (path, body = null, onResponse) => {
    await waitUntil(nextAt, job)
    try {
      return await api(path, body, undefined, onResponse)
    } finally {
      nextAt = Date.now() + interval
    }
  }
}

export class InviteRunner {
  constructor({
    data,
    save,
    query,
    emit,
    getConnection,
    onLog = () => {},
    onTaskState = async () => {},
  }) {
    Object.assign(this, {
      data,
      save,
      query,
      emit,
      getConnection,
      onLog,
      onTaskState,
    })
    this.jobs = new Map()
    this.taskStateQueues = new Map()
  }
  hasJobs(accountId) {
    return this.jobs.has(`${accountId}:collect`) || this.jobs.has(`${accountId}:invite`)
  }
  syncTaskState(accountId) {
    // Starts, stops and completions can overlap across kinds. Serialize native
    // writes per account and derive the aggregate when the queued write executes.
    const previous = this.taskStateQueues.get(accountId) || Promise.resolve()
    const pending = previous.then(() => {
      const collection = this.jobs.get(`${accountId}:collect`)
      const invitation = this.jobs.get(`${accountId}:invite`)
      const collecting = Boolean(collection && !collection.stopped)
      const inviting = Boolean(invitation && !invitation.stopped)
      return this.onTaskState(accountId, collecting || inviting, collecting)
    })
    // A failed native registration is reported to its caller; cleanup still runs.
    const settled = pending.catch(() => {}).finally(() => {
      if (this.taskStateQueues.get(accountId) === settled)
        this.taskStateQueues.delete(accountId)
    })
    this.taskStateQueues.set(accountId, settled)
    return pending
  }
  log(task, message, response) {
    const entry = {
      time: new Date().toISOString(),
      message,
      level: 'error',
      ...(response ? { response } : {}),
    }
    task.logs.push(entry)
    task.logs = task.logs.slice(-200)
    this.onLog({
      ...entry,
      accountId: task.accountId,
      platform: this.jobs.get(`${task.accountId}:${task.kind}`).platform,
      taskId: task.startedAt,
      kind: task.kind,
    })
    this.emit(task)
  }
  activity(task, entries) {
    const job = this.jobs.get(`${task.accountId}:${task.kind}`)
    const activities = entries.map((entry) => ({
      ...entry,
      id: crypto.randomUUID(),
      accountId: task.accountId,
      platform: job.platform,
      taskId: task.startedAt,
      kind: task.kind,
    }))
    job.activities.push(...activities)
    task.activity = [...(task.activity || []), ...activities].slice(-200)
  }
  async saveTask(task, changes = {}) {
    const pending = this.jobs.get(`${task.accountId}:${task.kind}`).activities
    const count = pending.length
    const result = await this.save({
      ...changes,
      tasks: { [`${task.accountId}:${task.kind}`]: task },
      ...(count ? { activities: pending.slice(0, count) } : {}),
    })
    pending.splice(0, count)
    return result
  }
  launch(job, task, operation) {
    // The IPC returns once started; report failures from the detached task too.
    job.promise = operation()
      .catch((error) => {
        task.status = 'stopped'
        task.current = `任务异常：${error.message}`
        this.log(task, task.current, error.response)
      })
      .finally(async () => {
        job.stopped = true
        try {
          await this.syncTaskState(task.accountId)
        } catch (error) {
          this.log(task, `停止任务失败：${error.message}`)
        }
        this.jobs.delete(`${task.accountId}:${task.kind}`)
        // Publish completion once, after releasing this kind. This also wakes
        // update installation waiting on jobs and exposes the final task if its
        // last persistence failed. Per-batch/record progress is emitted earlier.
        this.emit(
          task,
          ...(task.kind === 'collect' ? ['talents', 'collections'] : ['records'])
        )
      })
  }
  // Register native busy state and persist the task before launching detached work.
  // Failure releases this kind while retaining the other kind's native busy state.
  async saveStart(task) {
    const job = this.jobs.get(`${task.accountId}:${task.kind}`)
    try {
      await this.syncTaskState(task.accountId)
      if (job.stopped) await this.syncTaskState(task.accountId)
      await this.saveTask(task)
    } catch (error) {
      task.status = 'stopped'
      task.current = `任务保存失败：${error.message}`
      this.log(task, task.current)
      job.stopped = true
      try {
        await this.syncTaskState(task.accountId)
      } catch (releaseError) {
        this.log(task, `停止任务失败：${releaseError.message}`)
      } finally {
        // Native cleanup failure must not retain an unlaunched local job forever.
        this.jobs.delete(`${task.accountId}:${task.kind}`)
        this.emit(task)
      }
      error.logged = true
      throw error
    }
  }
  async stop(accountId, kind) {
    for (const target of kind ? [kind] : ['collect', 'invite']) {
      const job = this.jobs.get(`${accountId}:${target}`)
      if (job) {
        job.stopped = true
        job.wake?.()
      }
    }
    await this.syncTaskState(accountId)
  }
  createJob(accountId, platform, kind, current, total = 0) {
    const task = {
      accountId,
      kind,
      startedAt: new Date().toISOString(),
      logs: [],
      status: 'running',
      total,
      collected: 0,
      processed: 0,
      success: 0,
      skipped: 0,
      failed: 0,
      review: 0,
      current,
      filters: { keyword: '', category: 'all', fans: 'all', level: 'all' },
    }
    const job = { accountId, kind, platform, stopped: false, wake: null, promise: null, activities: [] }
    this.jobs.set(`${accountId}:${kind}`, job)
    this.data.tasks[`${accountId}:${kind}`] = task
    return { task, job }
  }
  async collect(accountId) {
    if (this.jobs.has(`${accountId}:collect`)) throw Error('该账号已有采集任务正在运行')
    const { platform, url, api, capture } = this.getConnection(accountId, 'collect')
    if (!isSupportedCollectionPage(platform, url))
      throw Error('当前页面不支持采集')
    if (!capture.list) throw Error('请先在当前平台页面搜索或应用筛选')
    // Responses can contain a full page of profiles. Collection only reads that
    // object; copy mutable request parameters without duplicating its large body.
    const snapshot = {
      list: { ...capture.list, body: structuredClone(capture.list.body) },
    }
    const { task, job } = this.createJob(
      accountId,
      platform,
      'collect',
      '正在采集达人'
    )
    task.filters.keyword =
      snapshot.list.body?.ext?.keyword ||
      snapshot.list.body?.filters?.keyword ||
      snapshot.list.body?.query ||
      snapshot.list.body?.sugWord ||
      ''
    this.activity(task, [
      { time: task.startedAt, level: 'info', message: '开始采集达人' },
    ])
    await this.saveStart(task)
    this.emit(task)
    this.launch(job, task, () =>
      this.runCollection(accountId, platform, api, snapshot, task, job)
    )
  }
  async runCollection(accountId, platform, api, capture, task, job) {
    const request = pacedRequest(api, 1000, job)
    const collection = {
      id: crypto.randomUUID(),
      accountId,
      platform,
      time: new Date().toISOString(),
      count: 0,
    }
    try {
      await collect({
        platform,
        capture,
        request,
        stopped: () => job.stopped,
        progress: async (count, text, batch) => {
          const collectedAt = new Date().toISOString()
          collection.count = count
          task.collected = count
          task.total = count
          const saved = await this.saveTask(task, {
            talents: batch.map((candidate) => ({
              ...candidate, platform, sourceAccountId: accountId, collectedAt,
            })),
            collections: [collection],
          })
          const updated = new Set(saved.updatedIds)
          task.current = `${text} · 新增 ${saved.added} · 已有 ${batch.length - saved.added}`
          this.activity(task, [
            ...saved.talents.map((talent) => ({
              time: collectedAt,
              level: 'success',
              message: `${talent.name} · ${updated.has(talent.id) ? '更新' : '新增'}`,
            })),
            { time: collectedAt, level: 'info', message: task.current },
          ])
          await this.saveTask(task)
          this.emit(task, 'talents', 'collections')
        },
      })
      task.status = job.stopped ? 'stopped' : 'done'
      task.current = job.stopped
        ? '采集已停止'
        : `采集完成，共 ${task.collected} 位达人`
    } catch (error) {
      task.status = 'stopped'
      task.current = error.message
      if (!(job.stopped && error.beforeSend))
        this.log(task, `采集失败：${error.message}`, error.response)
    }
    this.activity(task, [
      {
        time: new Date().toISOString(),
        level: task.status === 'done' ? 'success' : 'info',
        message:
          task.status === 'done'
            ? task.current
            : `采集已停止，共 ${task.collected} 位达人`,
      },
    ])
    await this.saveTask(task)
  }
  async start(accountId, config, talentIds) {
    if (this.jobs.has(`${accountId}:invite`)) throw Error('该账号已有邀约任务正在运行')
    const { platform, api } = this.getConnection(accountId, 'invite')
    validateConfig(platform, config)
    const selected = [...new Set(talentIds)]
    if (!selected.length) throw Error('请先从采集列表选择达人')
    const available = await this.query({ kind: 'talent_ids', platform, accountId, ids: selected })
    if (available.length !== selected.length)
      throw Error('所选达人不在当前账号的采集列表中')
    const snapshot = await this.query({ kind: 'invite_ids', platform, accountId, ids: available })
    if (!snapshot.length) throw Error('没有无邀约记录的达人')
    if (this.jobs.has(`${accountId}:invite`)) throw Error('该账号已有邀约任务正在运行')
    const configSnapshot = structuredClone(config)
    const { task, job } = this.createJob(
      accountId,
      platform,
      'invite',
      '正在准备邀约',
      snapshot.length
    )
    await this.saveStart(task)
    this.emit(task)
    this.launch(job, task, () =>
      this.run(accountId, platform, configSnapshot, api, snapshot, task, job)
    )
  }
  async *candidates(accountId, platform, ids, job) {
    for (let offset = 0; offset < ids.length && !job.stopped; offset += 200) {
      const batch = ids.slice(offset, offset + 200)
      const [talents, records] = await Promise.all([
        this.query({ kind: 'talent_batch', platform, accountId, ids: batch }),
        this.query({ kind: 'history', platform, accountId, ids: batch }),
      ])
      const history = new Map()
      for (const record of records) {
        const prior = history.get(record.talentId)
        if (prior) prior.push(record)
        else history.set(record.talentId, [record])
      }
      for (const candidate of talents) {
        if (job.stopped) return
        yield { candidate, history: history.get(candidate.id) || [] }
      }
    }
  }
  async run(accountId, platform, config, api, queue, task, job) {
    const waitForRetry = async (error, record) => {
      if (job.stopped || error.login || error.license || error.stopped) throw error
      const retryAt = Date.now() + 10000
      task.current = '邀约失败，10 秒后重试'
      if (record) {
        record.note = error.message
        if (error.response) record.response = error.response
      }
      await this.saveTask(task, record ? { records: [record] } : {})
      this.log(
        task,
        `${record ? `${record.name}（${record.talentId}）· ` : ''}邀约失败：${error.message}，10 秒后重试`,
        error.response
      )
      await waitUntil(retryAt, job)
    }
    // Preparation requests can resume at the failed step without sending a card.
    // Keep persistence outside the API catch so a disk error cannot resend a success.
    const request = async (path, body = null, onResponse) => {
      const current = task.current
      while (true) {
        if (job.stopped) throw Object.assign(Error('已停止'), { beforeSend: true })
        try {
          return await api(path, body, undefined, onResponse)
        } catch (error) {
          await waitForRetry(error)
          task.current = current
          this.emit(task)
        }
      }
    }
    let nextSendAt = 0
    const maxInvites = config.maxInvites ?? Infinity
    try {
      const contact = platform === 'kuaishou'
        ? (await request('/distribute/pc/seller/invite/contact?inviteType=1')).data
        : undefined
      const tags =
        platform === 'kuaishou'
          ? (
              await request('/gateway/distribute/pc/seller/invite/tag/query')
            ).data
              .filter((t) => t.selected === 1)
              .slice(0, 5)
          : []
      for await (const { candidate, history } of this.candidates(accountId, platform, queue, job)) {
        if (job.stopped || task.success >= maxInvites)
          break
        if (
          alreadyHandled(
            history, accountId, platform, candidate.id
          )
        ) {
          task.skipped++
          task.processed++
          // Long already-handled queues must give the UI a turn to render and
          // accept Stop, without copying history or emitting once per skipped row.
          if (task.processed % 100 === 0) {
            this.emit(task)
            await new Promise((resolve) => setTimeout(resolve, 0))
          }
          continue
        }
        task.current = candidate.name
        const record = {
          id: crypto.randomUUID(),
          accountId,
          platform,
          talentId: candidate.id,
          talentUid: candidate.uid,
          name: candidate.name,
          time: new Date().toISOString(),
          status: 'skipped',
          source: candidate.source,
          products: config.products,
          message: config.message,
          note: '',
        }
        let dispatched = false
        let savedSending = false
        let retryResponse
        const candidateRequest = (path, body = null) =>
          request(path, body, (response) => { record.response = response })
        try {
          const invitation = await prepareInvite(
            candidateRequest,
            platform,
            config,
            candidate,
            contact,
            tags
          )
          if (invitation.skip) {
            record.note = invitation.skip
            task.skipped++
          } else {
            while (true) {
              await waitUntil(nextSendAt, job)
              // Commit the same sending row before every dispatch. A process exit
              // leaves one reviewable record, never a success or a duplicate row.
              delete record.response
              record.note = ''
              record.status = 'sending'
              await this.saveTask(task, { records: [record] })
              savedSending = true
              if (job.stopped)
                throw Object.assign(Error('已停止'), { beforeSend: true })
              task.current = candidate.name
              this.emit(task, 'records')
              nextSendAt = Date.now() + config.interval
              try {
                await api(invitation.path, invitation.body, undefined, (response) => {
                  record.response = response
                })
                dispatched = true
                break
              } catch (error) {
                if (!error.beforeSend) dispatched = true
                if (error.response) retryResponse = error.response
                if (
                  platform === 'kuaishou' &&
                  /近7天有未处理|近7天.*被拒绝/.test(error.message)
                ) throw error
                // Retry the same card on either platform, including uncertain
                // transport failures. Stop interrupts the ten-second wait.
                await waitForRetry(error, record)
              }
            }
            record.status = 'success'
            task.success++
            task.processed++
            await this.saveTask(task, { records: [record] })
            this.emit(task, 'records')
            // Stop the generator before it loads another 200-row batch/history.
            if (task.success >= maxInvites) break
            continue
          }
        } catch (error) {
          if (record.status === 'success') throw error
          if (error.beforeSend) {
            if (savedSending) {
              if (dispatched) {
                record.status = 'review'
                record.note = `${error.message}，请核实上次邀约结果`
                record.response = retryResponse
                task.review++
                task.processed++
                await this.saveTask(task, { records: [record] })
              } else {
                await this.saveTask(task, { deleteRecordIds: [record.id] })
              }
            }
            throw error
          }
          if (
            platform === 'kuaishou' &&
            /近7天有未处理|近7天.*被拒绝/.test(error.message)
          ) {
            record.status = 'skipped'
            record.recentInvite = true
            task.skipped++
          } else {
            // Reaching here means cancellation, account loss, or persistence failure;
            // ordinary platform errors stay inside the retry loops above.
            record.status = dispatched && !error.rejected ? 'review' : 'failed'
            task[record.status]++
            job.stopped = true
          }
          record.note = error.message
          if (error.response) record.response = error.response
          if (record.status !== 'skipped')
            this.log(
              task,
              `${candidate.name}（${candidate.id}）· ${record.status === 'review' ? '待核实' : '失败'}：${error.message}`,
              error.response
            )
        }
        task.processed++
        await this.saveTask(task, { records: [record] })
        this.emit(task, 'records')
      }
      task.status = job.stopped ? 'stopped' : 'done'
      task.current = job.stopped
        ? task.review
          ? '结果待核实，已停止'
          : task.failed
            ? '邀约失败，已停止'
            : '已停止'
        : task.success >= maxInvites
          ? '已达到本次邀约上限'
          : task.review
            ? '本次处理完成，存在待核实记录'
            : '本次邀约已完成'
    } catch (error) {
      task.status = 'stopped'
      task.current = error.message
      if (!(job.stopped && error.beforeSend))
        this.log(task, `邀约中断：${error.message}`, error.response)
    }
    await this.saveTask(task)
  }
}
