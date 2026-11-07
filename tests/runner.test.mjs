/**
 * AI module map
 * Purpose: existing InviteRunner coverage for collection, deduplication, pacing, and uncertain sends.
 * Entry: node:test cases inject synthetic APIs, state, and save callbacks into the runner.
 * Flow: observe persisted task/record changes while faking database commits, send, cancellation, and
 * save failures. prepareInvite checks use fixture product/commission data.
 * Boundary: these scenarios model behavior only; do not substitute test accounts or outcomes
 * for production state and do not execute/extend the suite during comment maintenance.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareInvite, urls } from '../src/desktop-runtime/platform.mjs'
import {
  alreadyHandled,
  InviteRunner,
  validateConfig,
} from '../src/desktop-runtime/runner.mjs'

const config = {
  products: '123',
  message: '邀请合作',
  phone: '',
  wechat: 'test',
  interval: 500,
  maxInvites: 1,
}
const capture = {
  list: {
    mode: 'dy-square',
    method: 'POST',
    path: '/square_pc_api/square/search_feed_author',
    body: {
      filters: { keyword: '灭鼠', fans_min: 10000 },
      page: 3,
      type: 1,
      search_id: 'native-search',
    },
  },
}
const talent = {
  id: 'person',
  uid: '1',
  name: '达人',
  platform: 'douyin',
  source: '达人广场',
  sourceAccountId: 'a',
  collectedAt: new Date().toISOString(),
}
function state(talents = []) {
  return { records: [], tasks: {}, collections: [], talents }
}

// This fake models only the runner's incremental database boundary. The mutable
// arrays belong to the fake database, and saved/query rows cross it as clones.
function persistence(data, afterSave = async () => {}) {
  return {
    query: async ({ kind, platform, accountId, ids }) => {
      const talents = data.talents.filter((row) => row.platform === platform &&
        row.sourceAccountId === accountId && ids.includes(row.id))
      if (kind === 'talent_ids') return talents.map((row) => row.id)
      if (kind === 'talent_batch') return structuredClone(talents)
      assert.equal(kind, 'history')
      return structuredClone(data.records.filter((row) => row.platform === platform &&
        row.accountId === accountId && ids.includes(row.talentId)))
    },
    save: async (changes) => {
      let added = 0
      const talents = []
      const updatedIds = []
      for (const row of changes.talents || []) {
        const index = data.talents.findIndex((existing) => existing.platform === row.platform &&
          existing.sourceAccountId === row.sourceAccountId &&
          (existing.id === row.id || row.uid && existing.uid === row.uid))
        const saved = structuredClone(index === -1 ? row : { ...row, id: data.talents[index].id })
        if (index === -1) {
          data.talents.unshift(saved)
          added++
        } else {
          data.talents[index] = saved
          updatedIds.push(saved.id)
        }
        talents.push(saved)
      }
      for (const field of ['records', 'collections']) {
        for (const row of changes[field] || []) {
          const index = data[field].findIndex((existing) => existing.id === row.id)
          if (index === -1) data[field].unshift(structuredClone(row))
          else data[field][index] = structuredClone(row)
        }
      }
      if (changes.deleteRecordIds)
        data.records = data.records.filter((row) => !changes.deleteRecordIds.includes(row.id))
      await afterSave(changes)
      return { talents, added, updatedIds }
    },
  }
}

test('collection preserves filters, persists a deduplicated account list, and never checks quota or sends', async () => {
  const requests = []
  const saves = []
  const data = state()
  const runner = new InviteRunner({
    data,
    ...persistence(data, async () => { saves.push(structuredClone(data)) }),
    emit: () => {},
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async (path, body) => {
        assert.equal(path, capture.list.path)
        requests.push(body)
        return {
          data: {
            has_more: body.page === 1,
            list: [
              { author_base: { aweme_id: 'same', uid: '1', nickname: '达人' } },
            ],
          },
        }
      },
    }),
  })
  await runner.collect('a')
  await runner.jobs.get('a').promise
  assert.deepEqual(
    requests.map((x) => x.page),
    [1, 2]
  )
  assert.equal(requests[1].filters.keyword, '灭鼠')
  assert.equal(requests[1].filters.fans_min, 10000)
  assert.equal(requests[1].search_id, 'native-search')
  assert.equal(data.talents.length, 1)
  assert.equal(data.talents[0].sourceAccountId, 'a')
  assert.equal(data.tasks.a.kind, 'collect')
  assert.equal(data.tasks.a.status, 'done')
  assert.deepEqual(data.tasks.a.logs, [])
  assert.equal(data.collections[0].count, 1)
  assert.equal(data.records.length, 0)
  assert.ok(
    saves.some((s) => s.talents.length === 1 && s.tasks.a.status === 'running')
  )
})
test('history is scoped to the sending account, with seven-day Kuaishou expiry and unresolved review blocking', () => {
  const records = [
    {
      accountId: 'a',
      talentId: 't',
      status: 'success',
      time: new Date(Date.now() - 8 * 86400000).toISOString(),
    },
  ]
  assert.equal(alreadyHandled(records, 'a', 'kuaishou', 't'), false)
  assert.equal(alreadyHandled(records, 'a', 'douyin', 't'), true)
  assert.equal(alreadyHandled(records, 'b', 'douyin', 't'), false)
  records[0].status = 'review'
  assert.equal(alreadyHandled(records, 'a', 'kuaishou', 't'), true)
})
test('Douyin message limit and product configuration fail before any request', () => {
  assert.throws(
    () => validateConfig('douyin', { ...config, message: '字'.repeat(151) }),
    /150/
  )
  assert.doesNotThrow(() =>
    validateConfig('douyin', { ...config, message: '字'.repeat(150) })
  )
  assert.throws(() =>
    validateConfig('douyin', { ...config, products: '1,2,3,4,5,6' })
  )
  assert.doesNotThrow(() =>
    validateConfig('douyin', { ...config, products: '1,1,2,3,4,5' })
  )
})
test('product commission settings from the platform are retained in the outgoing invitation', async () => {
  const api = async (path) =>
    path.includes('account_check')
      ? { data: { is_passed: true, connection_type: 1 } }
      : {
          data: {
            promotion_list: [
              { product_id: '123', orient_cos_ratio_detail: { ratio: 20 } },
            ],
          },
        }
  const invite = await prepareInvite(
    api,
    'douyin',
    config,
    { uid: '1' },
    null,
    []
  )
  assert.deepEqual(
    invite.body.invite_card.product_setting[0].orient_cos_ratio_detail,
    { ratio: 20 }
  )
})
test('quota exhaustion is decided by the send response without proactively querying quota', async () => {
  const calls = []
  const data = state([{ ...talent }])
  const runner = new InviteRunner({
    data,
    ...persistence(data),
    emit: () => {},
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async (path) => {
        calls.push(path)
        if (path.includes('account_check'))
          return { data: { is_passed: true, connection_type: 1 } }
        if (path.includes('promotion/list'))
          return { data: { promotion_list: [{ product_id: '123' }] } }
        assert.equal(path, '/connection/pc/im/invite/card/send')
        throw Object.assign(Error('额度已用完'), { rejected: true })
      },
    }),
  })
  await runner.start('a', config, ['person'])
  await runner.jobs.get('a')?.promise
  assert.equal(calls.length, 3)
  assert.equal(data.records.length, 1)
  assert.equal(data.records[0].status, 'failed')
  assert.equal(data.tasks.a.status, 'stopped')
  assert.match(data.tasks.a.logs[0].message, /额度已用完/)
})
test('uncertain send is persisted as review and is not resent on the next run', async () => {
  const data = state([{ ...talent }])
  const saves = []
  const errors = []
  const response = {
    path: '/connection/pc/im/invite/card/send',
    method: 'POST',
    status: 501,
    body: '{"message":"平台异常","requestId":"request-501"}',
  }
  let sends = 0
  const api = async (path) => {
    if (path.includes('search_feed_author'))
      return {
        data: {
          has_more: false,
          list: [
            { author_base: { aweme_id: 'person', uid: '1', nickname: '达人' } },
          ],
        },
      }
    if (path.includes('account_check'))
      return { data: { is_passed: true, connection_type: 1 } }
    if (path.includes('promotion/list'))
      return { data: { promotion_list: [{ product_id: '123' }] } }
    sends++
    assert.equal(saves.at(-1).records[0].status, 'sending')
    throw Object.assign(Error('连接中断'), { response })
  }
  const runner = new InviteRunner({
    data,
    ...persistence(data, async () => { saves.push(structuredClone(data)) }),
    emit: () => {},
    onLog: (entry) => errors.push(entry),
    getConnection: () => ({ platform: 'douyin', url: urls.douyin, capture, api }),
  })
  await runner.start('a', config, ['person'])
  await runner.jobs.get('a')?.promise
  assert.equal(data.records[0].status, 'review')
  assert.equal(data.tasks.a.status, 'stopped')
  assert.equal(data.tasks.a.logs.length, 1)
  assert.deepEqual(data.tasks.a.logs[0].response, response)
  assert.deepEqual(data.records[0].response, response)
  await runner.start('a', config, ['person'])
  await runner.jobs.get('a')?.promise
  assert.equal(sends, 1)
  assert.equal(data.tasks.a.skipped, 1)
  assert.equal(errors.length, 1)
  assert.equal(errors[0].accountId, 'a')
  assert.equal(errors[0].platform, 'douyin')
  assert.equal(errors[0].level, 'error')
  assert.deepEqual(data.tasks.a.logs, [])
})

test('stopping collection retains the first persisted batch and never sends', async () => {
  const data = state()
  let runner
  let requests = 0
  runner = new InviteRunner({
    data,
    ...persistence(data, async () => {
      if (data.talents.length && data.tasks.a.status === 'running')
        await runner.stop('a')
    }),
    emit: () => {},
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async (path) => {
        assert.equal(path, capture.list.path)
        requests++
        return {
          data: {
            has_more: true,
            list: [
              {
                author_base: { aweme_id: 'person', uid: '1', nickname: '达人' },
              },
            ],
          },
        }
      },
    }),
  })
  await runner.collect('a')
  await runner.jobs.get('a').promise
  assert.equal(requests, 1)
  assert.equal(data.tasks.a.status, 'stopped')
  assert.equal(data.tasks.a.collected, 1)
  assert.deepEqual(data.tasks.a.logs, [])
  assert.equal(data.collections[0].count, 1)
  assert.equal(data.talents[0].id, 'person')
  assert.equal(data.records.length, 0)
})

test('account B rejects account A talents and sends only its own selected talent without searching again', async () => {
  const data = state([
    { ...talent },
    { ...talent, id: 'unselected', uid: '2' },
    { ...talent, platform: 'kuaishou' },
  ])
  data.records.push({
    accountId: 'a',
    platform: 'douyin',
    talentId: 'person',
    status: 'success',
    time: new Date().toISOString(),
  })
  const sends = []
  const runner = new InviteRunner({
    data,
    ...persistence(data),
    emit: () => {},
    getConnection: (accountId) => {
      assert.equal(accountId, 'b')
      return {
        platform: 'douyin',
        capture: {},
        api: async (path, body) => {
          assert.ok(!path.includes('search_feed_author'))
          if (path.includes('account_check'))
            return { data: { is_passed: true, connection_type: 1 } }
          if (path.includes('promotion/list'))
            return { data: { promotion_list: [{ product_id: '123' }] } }
          assert.equal(path, '/connection/pc/im/invite/card/send')
          sends.push(body.account_id)
          return { code: 0 }
        },
      }
    },
  })
  await assert.rejects(runner.start('b', config, ['person']), /当前账号/)
  assert.equal(sends.length, 0)
  assert.equal(runner.jobs.has('b'), false)
  data.talents.push({ ...talent, sourceAccountId: 'b', uid: '3' })
  await runner.start('b', config, ['person'])
  await runner.jobs.get('b').promise
  assert.deepEqual(sends, ['3'])
  assert.equal(data.records[0].accountId, 'b')
  assert.equal(data.records[0].status, 'success')
  assert.equal(data.tasks.b.kind, 'invite')
  assert.equal(data.tasks.b.total, 1)
  assert.equal(data.talents.length, 4)
})

test('collection errors retain the saved batch and the specific response in error-only logs', async () => {
  const data = state()
  const response = {
    path: capture.list.path,
    method: 'POST',
    status: 401,
    body: '{"message":"登录过期"}',
  }
  const runner = new InviteRunner({
    data,
    ...persistence(data),
    emit: () => {},
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async (_path, body) => {
        if (body.page === 2)
          throw Object.assign(Error('登录过期'), { response, login: true })
        return {
          data: {
            has_more: true,
            list: [
              {
                author_base: { aweme_id: 'person', uid: '1', nickname: '达人' },
              },
            ],
          },
        }
      },
    }),
  })
  await runner.collect('a')
  await runner.jobs.get('a').promise
  assert.equal(data.talents.length, 1)
  assert.equal(data.tasks.a.status, 'stopped')
  assert.equal(data.tasks.a.logs.length, 1)
  assert.deepEqual(data.tasks.a.logs[0].response, response)
  assert.equal(data.tasks.a.logs[0].level, 'error')
  assert.equal(data.records.length, 0)
})

test('a failed initial save releases the account and reports the cause before any platform request', async () => {
  const data = state()
  let writable = false
  let calls = 0
  const runner = new InviteRunner({
    data,
    ...persistence(data, async () => {
      if (!writable) throw Error('ENOSPC: disk full')
    }),
    emit: () => {},
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async () => {
        calls++
        return { data: { has_more: false, list: [] } }
      },
    }),
  })
  await assert.rejects(runner.collect('a'), /ENOSPC/)
  assert.equal(calls, 0)
  assert.equal(runner.jobs.has('a'), false)
  assert.equal(data.tasks.a.status, 'stopped')
  assert.match(data.tasks.a.logs[0].message, /保存失败.*ENOSPC/)
  writable = true
  await runner.collect('a')
  await runner.jobs.get('a').promise
  assert.equal(calls, 1)
  assert.equal(data.tasks.a.status, 'done')
})

test('a background final-save failure is visible and releases the task instead of rejecting unobserved', async () => {
  const data = state()
  let saves = 0
  const errors = []
  const runner = new InviteRunner({
    data,
    ...persistence(data, async () => {
      if (++saves > 1) throw Error('EACCES: assistant.sqlite3')
    }),
    emit: () => {},
    onLog: (entry) => errors.push(entry),
    getConnection: () => ({
      platform: 'douyin',
      url: urls.douyin,
      capture,
      api: async () => ({ data: { has_more: false, list: [] } }),
    }),
  })
  await runner.collect('a')
  await runner.jobs.get('a').promise
  assert.equal(runner.jobs.has('a'), false)
  assert.equal(data.tasks.a.status, 'stopped')
  assert.match(errors[0].message, /EACCES/)
  assert.equal(errors[0].level, 'error')
})
