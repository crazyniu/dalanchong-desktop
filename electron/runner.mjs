import { randomUUID } from 'node:crypto'
import { collect, readQuota, prepareInvite } from './platform.mjs'

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
  if (
    !Number.isSafeInteger(config.interval) ||
    config.interval < 500 ||
    config.interval > 60000
  )
    throw Error('请求间隔为 500–60000 毫秒')
  if (!Number.isSafeInteger(config.maxInvites) || config.maxInvites < 1)
    throw Error('本次邀约上限须为正整数')
}

export function alreadyHandled(records, accountId, platform, talentId) {
  return records.some(
    (r) =>
      r.accountId === accountId &&
      r.talentId === talentId &&
      (r.status === 'review' ||
        r.status === 'sending' ||
        ((r.status === 'success' || r.recentInvite) &&
          (platform === 'douyin' ||
            Date.now() - Date.parse(r.resolution || r.time) < 7 * 86400000)))
  )
}

function pacedRequest(api, interval, job) {
  let nextAt = 0
  return async (path, body = null) => {
    const wait = nextAt - Date.now()
    if (wait > 0)
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, wait)
        job.wake = () => {
          clearTimeout(timer)
          resolve()
        }
      })
    if (job.stopped) throw Object.assign(Error('已停止'), { beforeSend: true })
    try {
      return await api(path, body)
    } finally {
      nextAt = Date.now() + interval
    }
  }
}

export class InviteRunner {
  constructor({ data, save, emit, getConnection, onQuota, onLog = () => {} }) {
    Object.assign(this, { data, save, emit, getConnection, onQuota, onLog })
    this.jobs = new Map()
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
      platform: this.jobs.get(task.accountId).platform,
      taskId: task.startedAt,
      kind: task.kind,
    })
    this.emit()
  }
  launch(job, task, operation) {
    // The IPC returns once started; report failures from the detached task too.
    job.promise = operation()
      .catch((error) => {
        task.status = 'stopped'
        task.current = `任务异常：${error.message}`
        this.log(task, task.current, error.response)
      })
      .finally(() => this.jobs.delete(task.accountId))
  }
  async saveStart(task) {
    try {
      await this.save()
    } catch (error) {
      task.status = 'stopped'
      task.current = `任务保存失败：${error.message}`
      this.log(task, task.current)
      this.jobs.delete(task.accountId)
      error.logged = true
      throw error
    }
  }
  stop(id) {
    const job = this.jobs.get(id)
    if (job) {
      job.stopped = true
      job.wake?.()
    }
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
    const job = { platform, stopped: false, wake: null, promise: null }
    this.jobs.set(accountId, job)
    this.data.tasks[accountId] = task
    return { task, job }
  }
  async collect(accountId) {
    if (this.jobs.has(accountId)) throw Error('该账号已有任务正在运行')
    const { platform, api, capture } = this.getConnection(accountId)
    if (!capture.search) throw Error('请先在平台网页搜索或应用筛选')
    const snapshot = structuredClone(capture)
    const { task, job } = this.createJob(
      accountId,
      platform,
      'collect',
      '正在采集达人'
    )
    task.filters.keyword =
      snapshot.search.body.ext?.keyword ||
      snapshot.search.body.filters?.keyword ||
      ''
    await this.saveStart(task)
    this.emit()
    this.launch(job, task, () =>
      this.runCollection(accountId, platform, api, snapshot, task, job)
    )
  }
  async runCollection(accountId, platform, api, capture, task, job) {
    const request = pacedRequest(api, 1000, job)
    const collection = {
      id: randomUUID(),
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
          const stored = new Map(
            this.data.talents.map((t) => [`${t.platform}:${t.id}`, t])
          )
          const collectedAt = new Date().toISOString()
          let added = 0
          for (const candidate of batch) {
            const talent = {
              ...candidate,
              platform,
              sourceAccountId: accountId,
              collectedAt,
            }
            const existing = stored.get(`${platform}:${candidate.id}`)
            if (existing) Object.assign(existing, talent)
            else {
              added++
              this.data.talents.push(talent)
              stored.set(`${platform}:${candidate.id}`, talent)
            }
          }
          if (count && !collection.count) this.data.collections.push(collection)
          collection.count = count
          task.collected = count
          task.total = count
          task.current = `${text} · 新增 ${added} · 已有 ${batch.length - added}`
          await this.save()
          this.emit()
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
    await this.save()
    this.emit()
  }
  async start(accountId, config, talentIds) {
    if (this.jobs.has(accountId)) throw Error('该账号已有任务正在运行')
    const { platform, api } = this.getConnection(accountId)
    validateConfig(platform, config)
    const selected = new Set(talentIds)
    if (!selected.size) throw Error('请先从采集列表选择达人')
    const queue = this.data.talents.filter(
      (t) => t.platform === platform && selected.has(t.id)
    )
    if (queue.length !== selected.size)
      throw Error('所选达人不在该平台的采集列表中')
    const snapshot = structuredClone(queue)
    const { task, job } = this.createJob(
      accountId,
      platform,
      'invite',
      '读取邀约额度',
      snapshot.length
    )
    await this.saveStart(task)
    this.emit()
    this.launch(job, task, () =>
      this.run(
        accountId,
        platform,
        structuredClone(config),
        api,
        snapshot,
        task,
        job
      )
    )
  }
  async run(accountId, platform, config, api, queue, task, job) {
    const request = pacedRequest(api, config.interval, job)
    try {
      let quota = await readQuota(request, platform)
      this.onQuota(accountId, quota)
      if (quota.remaining === 0) throw Error('邀约额度已用完')
      const tags =
        platform === 'kuaishou'
          ? (
              await request('/gateway/distribute/pc/seller/invite/tag/query')
            ).data
              .filter((t) => t.selected === 1)
              .slice(0, 5)
          : []
      for (const candidate of queue) {
        if (
          job.stopped ||
          task.success >= config.maxInvites ||
          quota.remaining === 0
        )
          break
        task.current = candidate.name
        const record = {
          id: randomUUID(),
          accountId,
          platform,
          talentId: candidate.id,
          name: candidate.name,
          time: new Date().toISOString(),
          status: 'skipped',
          source: candidate.source,
          products: config.products,
          message: config.message,
          note: '',
        }
        if (
          alreadyHandled(this.data.records, accountId, platform, candidate.id)
        ) {
          task.skipped++
          task.processed++
          this.emit()
          continue
        }
        let sending = false
        try {
          const invitation = await prepareInvite(
            request,
            platform,
            config,
            candidate,
            quota,
            tags
          )
          if (invitation.skip) {
            record.note = invitation.skip
            this.data.records.unshift(record)
            task.skipped++
          } else {
            if (job.stopped) break
            record.status = 'sending'
            this.data.records.unshift(record)
            await this.save()
            this.emit()
            sending = true
            await request(invitation.path, invitation.body)
            record.status = 'success'
            task.success++
            quota.remaining--
            task.processed++
            await this.save()
            this.emit()
            this.onQuota(accountId, quota)
            if (platform === 'douyin') {
              quota = await readQuota(request, platform)
              this.onQuota(accountId, quota)
            }
            continue
          }
        } catch (error) {
          if (record.status === 'success') throw error
          if (error.beforeSend) {
            if (sending)
              this.data.records.splice(this.data.records.indexOf(record), 1)
            throw error
          }
          if (!sending && !this.data.records.includes(record))
            this.data.records.unshift(record)
          if (
            platform === 'kuaishou' &&
            /近7天有未处理|近7天.*被拒绝/.test(error.message)
          ) {
            record.status = 'skipped'
            record.recentInvite = true
            task.skipped++
          } else {
            record.status = sending && !error.rejected ? 'review' : 'failed'
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
        await this.save()
        this.emit()
      }
      task.status = job.stopped ? 'stopped' : 'done'
      task.current = job.stopped
        ? task.review
          ? '结果待核实，已停止'
          : task.failed
            ? '邀约失败，已停止'
            : '已停止'
        : quota.remaining === 0
          ? '额度已用完'
          : task.success >= config.maxInvites
            ? '已达到本次邀约上限'
            : '本次邀约已完成'
    } catch (error) {
      task.status = 'stopped'
      task.current = error.message
      if (!(job.stopped && error.beforeSend))
        this.log(task, `邀约中断：${error.message}`, error.response)
    }
    await this.save()
    this.emit()
  }
}
