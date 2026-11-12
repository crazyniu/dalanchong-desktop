/**
 * AI module map
 * Purpose: existing unit coverage for runtime orchestration with an injected native transport.
 * Entry: node:test cases construct harness() using fake invoke/listen callbacks and in-memory data.
 * Flow: emit synthetic browser events, inspect requested operations/saved snapshots, and
 * exercise quota/filter/login state without real platform accounts.
 * Boundary: these fixtures document expected contracts, not production API availability
 * or live licensing. Comment maintenance must not run, extend, or change the tests.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { makeApi, urls } from './platform.mjs'
import { InviteRunner } from './runner.mjs'
import { createRuntime } from './runtime.mjs'

function harness(
  data = { logs: [], talents: [], records: [], tasks: {}, collections: [] },
  evaluate = async () => undefined
) {
  const handlers = new Map()
  const calls = []
  const events = []
  const saved = []
  const bridge = createRuntime(
    async (command, args) => {
      calls.push({ command, args })
      if (command === 'license_state') return { valid: true }
      if (command === 'runtime_load') return structuredClone(data)
      if (command === 'runtime_save') saved.push(structuredClone(args.data))
      if (command === 'database_query') {
        assert.equal(args.request.kind, 'record')
        return structuredClone(data.records.find((row) => row.id === args.request.id))
      }
      if (command === 'browser_prepare')
        return { url: urls[args.account.platform] }
      if (command === 'platform_eval') return evaluate(args)
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

function identity(h, order, data, workspace = false) {
  const request = {
    kind: 'account',
    order,
    path: '/index/getUser',
    url: 'https://buyin.jinritemai.com/index/getUser',
    method: 'GET',
    body: null,
  }
  h.browser({
    type: 'response',
    workspace,
    request: { ...request, phase: 'pending' },
  })
  h.browser({
    type: 'response',
    workspace,
    request: { ...request, phase: 'complete' },
    response: {
      status: 200,
      url: request.url,
      text: JSON.stringify({ code: 0, data }),
    },
  })
}

test('confirmed popup login closes once and an old workspace quota failure cannot expire it', async () => {
  const h = harness()
  await h.bridge.getLicenseState()
  await h.bridge.openAccountLogin({
    id: 'a',
    platform: 'douyin',
    name: '账号备注',
  })
  h.browser({ type: 'ready', url: urls.douyin })
  const quotaRequest = {
    kind: 'quota', order: 1,
    path: '/connection/pc/im/shop_contact_rights_info',
    url: 'https://buyin.jinritemai.com/connection/pc/im/shop_contact_rights_info',
    method: 'GET', body: null,
  }
  h.browser({ type: 'response', request: { ...quotaRequest, phase: 'pending' } })
  await new Promise(setImmediate)
  assert.equal(h.calls.filter((c) => c.command === 'platform_eval').length, 0)

  identity(h, 1, { shop_id: '0', shop_name: '' })
  assert.equal(
    h.calls.filter((c) => c.command === 'browser_finish_login').length,
    0
  )
  identity(h, 2, { shop_id: 'shop-1', shop_name: '店铺一' })
  identity(h, 3, { shop_id: 'shop-1', shop_name: '店铺一' })
  h.browser({
    type: 'response', request: { ...quotaRequest, phase: 'complete' },
    response: {
      status: 200,
      url: quotaRequest.url,
      text: JSON.stringify({ code: -2, msg: '用户未登录' }),
    },
  })
  await new Promise(setImmediate)

  const patch = h.events
    .filter((e) => e.type === 'account' && e.patch.status)
    .at(-1).patch
  assert.deepEqual(patch, {
    shopId: 'shop-1',
    shopName: '店铺一',
    status: 'online',
  })
  assert.deepEqual(
    h.calls.filter((c) => c.command === 'browser_finish_login'),
    [{ command: 'browser_finish_login', args: { accountId: 'a' } }]
  )
  assert.equal(h.calls.filter((c) => c.command === 'platform_eval').length, 0)
  assert.equal(
    h.calls.filter((c) => c.command === 'diagnostic_append').length,
    0
  )
})

test('opening an existing account keeps its browser open and another workspace cannot finish popup login', async () => {
  const h = harness()
  await h.bridge.getLicenseState()
  const account = { id: 'a', platform: 'douyin', name: '账号备注' }
  await h.bridge.openAccountLogin(account, false)
  identity(h, 1, { shop_id: 'shop-1', shop_name: '店铺一' })
  assert.equal(
    h.calls.filter((c) => c.command === 'browser_finish_login').length,
    0
  )
  await h.bridge.openAccountLogin(account)
  identity(h, 2, { shop_id: 'shop-1', shop_name: '店铺一' }, true)
  assert.equal(
    h.calls.filter((c) => c.command === 'browser_finish_login').length,
    0
  )
  identity(h, 3, { shop_id: 'shop-1', shop_name: '店铺一' })
  assert.equal(
    h.calls.filter((c) => c.command === 'browser_finish_login').length,
    1
  )
})

test('restart retains native-recovered records in the database, stops tasks and preserves native preferences', async () => {
  const h = harness({
    logs: [],
    talents: [],
    collections: [],
    // Native runtime_load has already recovered uncertain sends in SQLite.
    records: [{ id: 'r', status: 'review' }],
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
  assert.deepEqual(data.records, [])
  assert.equal((await h.bridge.queryData({ kind: 'record', id: 'r' })).status, 'review')
  assert.equal(data.tasks.a.status, 'stopped')
  assert.equal(data.accounts[0].status, 'offline')
  assert.equal(data.accounts[0].name, '测试备注')
  assert.equal(data.logs.length, 1)
  assert.deepEqual(data.tasks.a.logs, [])
  assert.equal(h.saved.at(-1).records, undefined)
  assert.equal(h.saved.at(-1).tasks.a.status, 'stopped')
  assert.equal(h.calls.filter((c) => c.command === 'platform_eval').length, 0)
  const native = h.calls.find((c) => c.command === 'set_task_state')
  assert.equal(native.args.running, false)
})

test('stop works before initialization without invoking authorization or reading protected data', async () => {
  const h = harness()
  await h.bridge.stop('a')
  assert.deepEqual(h.calls, [
    { command: 'set_task_state', args: { accountId: 'a', running: false, collecting: false } },
  ])
})

test('observation keeps newest workspace filters and excludes login-window search results', async () => {
  const h = harness()
  await h.bridge.getLicenseState()
  await h.bridge.prepareAccount({ id: 'a', platform: 'douyin' })
  const request = (order, phase) => ({
    kind: 'list',
    order,
    phase,
    path: '/square_pc_api/square/search_feed_author',
    url: 'https://buyin.jinritemai.com/square_pc_api/square/search_feed_author',
    method: 'POST',
    pageUrl: urls.douyin,
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
  let entered
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const entering = new Promise((resolve) => { entered = resolve })
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
      if (running) {
        entered()
        await gate
      }
    },
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture: { list: { mode: 'dy-square', method: 'POST', body: {}, path: '/search' } },
      api: async () => {
        requests++
        return { data: { list: [], has_more: false } }
      },
    }),
  })
  const starting = runner.collect('a')
  await entering
  const stopping = runner.stop('a')
  release()
  await stopping
  await starting
  await runner.jobs.get('a:collect')?.promise
  assert.equal(requests, 0)
  assert.equal(data.tasks['a:collect'].status, 'stopped')
  assert.equal(states[0], true)
  assert.ok(states.slice(1).every((running) => running === false))
})
