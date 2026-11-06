import assert from 'node:assert/strict'
import test from 'node:test'
import { makeApi, urls } from './platform.mjs'
import { InviteRunner } from './runner.mjs'
import { createRuntime } from './runtime.mjs'

function harness(
  data = { logs: [], talents: [], records: [], tasks: {}, collections: [] }
) {
  const handlers = new Map()
  const calls = []
  const events = []
  const saved = []
  const bridge = createRuntime(
    async (command, args) => {
      calls.push({ command, args })
      if (command === 'license_verify') return { valid: true }
      if (command === 'runtime_load') return structuredClone(data)
      if (command === 'runtime_save') saved.push(structuredClone(args.data))
      if (command === 'browser_prepare') return { url: urls.douyin }
    },
    async (name, callback) => {
      handlers.set(name, callback)
      return () => {}
    },
    null
  )
  bridge.onEvent((event) => events.push(event))
  const browser = (payload) =>
    handlers.get('assistant:browser')({
      payload: { accountId: 'a', workspace: true, ...payload },
    })
  return { bridge, calls, events, saved, browser }
}

test('restart converts in-flight records to review, stops tasks and preserves native preferences', async () => {
  const h = harness({
    logs: [],
    talents: [],
    collections: [],
    records: [{ id: 'r', status: 'sending' }],
    tasks: {
      a: {
        accountId: 'a',
        status: 'running',
        kind: 'invite',
        logs: [{ level: 'info' }],
      },
    },
    accounts: [
      { id: 'a', platform: 'douyin', status: 'online', name: '测试备注' },
    ],
    configs: { a: { products: '123' } },
  })
  const data = await h.bridge.initialize()
  assert.equal(data.records[0].status, 'review')
  assert.equal(data.tasks.a.status, 'stopped')
  assert.equal(data.accounts[0].status, 'offline')
  assert.equal(data.accounts[0].name, '测试备注')
  assert.equal(data.logs.length, 1)
  assert.deepEqual(data.tasks.a.logs, [])
  assert.equal(h.saved.at(-1).records[0].status, 'review')
  assert.equal(h.calls.filter((c) => c.command === 'platform_eval').length, 0)
  const native = h.calls.find((c) => c.command === 'set_task_state')
  assert.equal(native.args.running, false)
})

test('stop works before initialization without invoking authorization or reading protected data', async () => {
  const h = harness()
  await h.bridge.stop('a')
  assert.deepEqual(h.calls, [
    { command: 'set_task_state', args: { accountId: 'a', running: false } },
  ])
})

test('observation keeps newest workspace filters and excludes login-window search results', async () => {
  const h = harness()
  await h.bridge.prepareAccount({ id: 'a', platform: 'douyin' })
  const request = (order, phase) => ({
    kind: 'search',
    order,
    phase,
    path: '/square_pc_api/square/search_feed_author',
    url: 'https://buyin.jinritemai.com/square_pc_api/square/search_feed_author',
    method: 'POST',
    body: { page: 1, filters: { keyword: String(order) } },
  })
  const response = {
    status: 200,
    url: request(1, '').url,
    text: JSON.stringify({ code: 0, data: { list: [], has_more: false } }),
  }
  h.browser({ type: 'response', request: request(1, 'pending') })
  h.browser({ type: 'response', request: request(2, 'pending') })
  h.browser({ type: 'response', request: request(1, 'complete'), response })
  assert.equal(h.events.filter((e) => e.type === 'capture').at(-1).ready, false)
  h.browser({
    type: 'response',
    workspace: false,
    request: request(3, 'pending'),
  })
  h.browser({
    type: 'response',
    workspace: false,
    request: request(3, 'complete'),
    response,
  })
  assert.equal(h.events.filter((e) => e.type === 'capture').at(-1).ready, false)
  h.browser({ type: 'response', request: request(2, 'complete'), response })
  assert.equal(h.events.filter((e) => e.type === 'capture').at(-1).ready, true)
  h.browser({ type: 'navigation', url: urls.douyin })
  assert.equal(h.events.filter((e) => e.type === 'capture').at(-1).ready, false)
})

test('native pre-send denial survives the page adapter; unknown execution failures remain uncertain', async () => {
  for (const beforeSend of [true, undefined]) {
    let request
    const api = makeApi(
      {
        getURL: () => urls.douyin,
        executeJavaScript: async (_script, metadata) => {
          request = metadata
          throw Object.assign(Error('拒绝或中断'), { beforeSend })
        },
      },
      'douyin'
    )
    await assert.rejects(api('/send', { item: '123' }), (error) => {
      assert.equal(error.beforeSend, beforeSend === true)
      return true
    })
    assert.deepEqual(request, { path: '/send', body: { item: '123' } })
  }
})

test('stop during asynchronous native authorization closes the gate before any task request', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const states = []
  let requests = 0
  const data = {
    logs: [],
    talents: [],
    records: [],
    tasks: {},
    collections: [],
  }
  const runner = new InviteRunner({
    data,
    save: async () => {},
    emit: () => {},
    onQuota: () => {},
    onTaskState: async (_id, running) => {
      states.push(running)
      if (running) await gate
    },
    getConnection: () => ({
      platform: 'douyin',
      capture: { search: { body: {}, path: '/search' } },
      api: async () => {
        requests++
        return { data: { list: [], has_more: false } }
      },
    }),
  })
  const starting = runner.collect('a')
  await runner.stop('a')
  release()
  await starting
  await runner.jobs.get('a')?.promise
  assert.equal(requests, 0)
  assert.equal(data.tasks.a.status, 'stopped')
  assert.deepEqual(states, [true, false, false, false])
})
