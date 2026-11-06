import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  classifyObservedRequest,
  collect,
  interpretObservedResponse,
  makeApi,
  readQuota,
  urls,
} from '../src/desktop-runtime/platform.mjs'

const sendPath = '/connection/pc/im/invite/card/send'
function returnedApi(result, platform = 'douyin') {
  return makeApi(
    { getURL: () => urls[platform], executeJavaScript: async () => result },
    platform
  )
}
function response(code, extra = {}) {
  return {
    status: 200,
    url: 'https://buyin.jinritemai.com' + sendPath,
    text: JSON.stringify({ code, msg: '平台拒绝请求', ...extra }),
    requestId: 'request-123',
  }
}

test('HTTP and non-JSON errors retain bounded response details and redact credentials', async () => {
  const body =
    '<html>Cookie: session=private-cookie; sid=private-sid\nAuthorization: Bearer private-auth\n' +
    'x'.repeat(8500) +
    '</html>'
  const api = returnedApi(
    {
      status: 501,
      url: 'https://cps.kwaixiaodian.com/send',
      text: body,
      requestId: 'gateway-501',
    },
    'kuaishou'
  )
  await assert.rejects(
    api('/send?token=request-secret', { invite: true }),
    (error) => {
      assert.equal(error.response.status, 501)
      assert.equal(error.response.method, 'POST')
      assert.equal(error.response.path, '/send')
      assert.equal(error.response.requestId, 'gateway-501')
      assert.ok(error.response.body.length < 8050)
      assert.ok(error.response.body.includes('已截断'))
      assert.doesNotMatch(
        JSON.stringify(error.response),
        /private-|request-secret/
      )
      assert.notEqual(error.rejected, true)
      return true
    }
  )
})

test('only confirmed Douyin rejection codes are retryable failures and response data is sanitized', async () => {
  for (const code of [-3, -4, 99]) {
    const api = returnedApi(
      response(code, {
        contact: { phone: 'private-phone' },
        nested: {
          access_token: 'private-token',
          message: 'token=private-inline',
        },
        detail: '业务检查细节',
      })
    )
    await assert.rejects(api(sendPath, {}), (error) => {
      assert.equal(error.rejected, code === -3 || code === -4)
      assert.equal(error.response.code, code)
      assert.equal(error.response.requestId, 'request-123')
      assert.match(error.response.body, /业务检查细节/)
      assert.doesNotMatch(error.response.body, /private-/)
      return true
    })
  }
})

test('401, redirected login and login business messages preserve diagnostics and mark login expired', async () => {
  for (const result of [
    { ...response(1), status: 401 },
    { ...response(1), url: 'https://login.jinritemai.com/' },
    response(1, { msg: 'login_required' }),
  ]) {
    await assert.rejects(returnedApi(result)('/quota'), (error) => {
      assert.equal(error.login, true)
      assert.equal(error.response.status, result.status)
      assert.equal(error.response.code, 1)
      assert.equal(error.response.method, 'GET')
      assert.equal(error.response.requestId, 'request-123')
      assert.ok(error.response.body)
      return true
    })
  }
})

test('network and execution failures keep request context without claiming the invitation was rejected', async () => {
  const results = [
    async () => ({ error: 'Failed to fetch', beforeSend: false }),
    async () => {
      throw Error('Execution context was destroyed')
    },
  ]
  for (const executeJavaScript of results) {
    const api = makeApi(
      { getURL: () => urls.douyin, executeJavaScript },
      'douyin'
    )
    await assert.rejects(api(sendPath, {}), (error) => {
      assert.notEqual(error.beforeSend, true)
      assert.notEqual(error.rejected, true)
      assert.equal(error.response.path, sendPath)
      assert.equal(error.response.method, 'POST')
      assert.ok(error.response.message)
      return true
    })
  }
})

test('actual injected SDK failure is beforeSend and never calls fetch', async () => {
  let fetches = 0
  const api = makeApi(
    {
      getURL: () => urls.douyin,
      executeJavaScript: (script) =>
        vm.runInNewContext(script, {
          window: {
            webpackChunkmain: {
              push() {
                throw Error('SDK not ready')
              },
            },
          },
          crypto: { randomUUID: () => 'test' },
          fetch() {
            fetches++
            throw Error('unexpected fetch')
          },
        }),
    },
    'douyin'
  )
  await assert.rejects(api(sendPath, {}), (error) => {
    assert.equal(error.beforeSend, true)
    assert.match(error.response.message, /SDK not ready/)
    assert.equal(error.response.path, sendPath)
    return true
  })
  assert.equal(fetches, 0)
})

test('missing or invalid quotas fail explicitly instead of returning NaN or treating missing values as zero', async () => {
  await assert.rejects(
    readQuota(
      async () => ({ result: 1, data: { phoneNumber: 'private-phone' } }),
      'kuaishou'
    ),
    (error) => {
      assert.match(error.message, /有效.*额度/)
      assert.doesNotMatch(error.response.body, /private-phone/)
      return true
    }
  )
  for (const data of [
    { shop_gmv_type: 0, online_rights: [], right_list_v2: [] },
    { shop_gmv_type: 1, online_rights: [{}], right_list_v2: [] },
  ])
    await assert.rejects(
      readQuota(async () => ({ code: 0, data }), 'douyin'),
      /有效邀约额度/
    )
  assert.equal(
    (
      await readQuota(
        async () => ({ result: 1, data: { remainingSendCnt: '0' } }),
        'kuaishou'
      )
    ).remaining,
    0
  )
})

test('observations accept only platform business endpoints and confirm filters only on successful responses', () => {
  assert.equal(
    classifyObservedRequest(
      'douyin',
      'https://example.invalid/square_pc_api/square/search_feed_author',
      '{broken'
    ),
    null
  )
  assert.equal(
    classifyObservedRequest(
      'douyin',
      'https://buyin.jinritemai.com/analytics',
      '{broken'
    ),
    null
  )
  const request = classifyObservedRequest(
    'douyin',
    'https://buyin.jinritemai.com/square_pc_api/square/search_feed_author',
    JSON.stringify({ page: 2, filters: { keyword: '家居' } })
  )
  assert.throws(
    () =>
      interpretObservedResponse('douyin', request, {
        code: 10,
        msg: 'login_required',
      }),
    (error) => error.login && error.response.code === 10
  )
  assert.throws(
    () =>
      interpretObservedResponse('douyin', request, '<html>Bad Gateway</html>', {
        status: 502,
      }),
    /HTTP 502/
  )
  const { capture } = interpretObservedResponse('douyin', request, {
    code: 0,
    data: { list: [], has_more: false },
  })
  assert.equal(capture.body.page, 2)
  assert.equal(capture.body.filters.keyword, '家居')
  assert.deepEqual(capture.response.data.list, [])
  assert.ok(Date.now() - capture.responseAt < 1000)
})

test('collection reuses only a fresh matching observed page without skipping earlier or later pages', async () => {
  const pageResult = (page) => ({
    code: 0,
    data: {
      list: [
        {
          author_base: {
            aweme_id: String(page),
            uid: String(page),
            nickname: `达人${page}`,
          },
        },
      ],
      has_more: page < 4,
    },
  })
  const request = classifyObservedRequest(
    'douyin',
    'https://buyin.jinritemai.com/square_pc_api/square/search_feed_author',
    { page: 3, filters: { keyword: '家居' } }
  )
  const { capture } = interpretObservedResponse(
    'douyin',
    request,
    pageResult(3)
  )
  for (const age of [0, 61_000]) {
    const calls = []
    const talents = await collect({
      platform: 'douyin',
      capture: { search: { ...capture, responseAt: Date.now() - age } },
      request: async (_path, body) => {
        calls.push(body.page)
        assert.equal(body.filters.keyword, '家居')
        return pageResult(body.page)
      },
      stopped: () => false,
      progress: async () => {},
    })
    assert.deepEqual(calls, age ? [1, 2, 3, 4] : [1, 2, 4])
    assert.deepEqual(
      talents.map((t) => t.id),
      ['1', '2', '3', '4']
    )
  }
  const calls = []
  const base = 'https://cps.kwaixiaodian.com'
  const search = classifyObservedRequest(
    'kuaishou',
    base + '/gateway/distribute/match/common/orchestration/execute',
    { scene: 'distribute_peer_seller_list', pageNum: 2, pageSize: 1 }
  )
  const promoter = classifyObservedRequest(
    'kuaishou',
    base + '/gateway/distribute/pc/common/promoter/list',
    {
      sceneCode: 'ps_seller_coop_promoter_list',
      ext: { sellerId: '2', timeRange: '30d' },
    }
  )
  const shops = (page) => ({
    result: 1,
    total: 2,
    dataList: [{ sellerId: String(page), sellerName: `店铺${page}` }],
  })
  const promoters = (id) => ({
    result: 1,
    data: { promoterDataInfo: [{ promoterId: id, nickname: `达人${id}` }] },
  })
  const talents = await collect({
    platform: 'kuaishou',
    capture: {
      search: interpretObservedResponse('kuaishou', search, shops(2)).capture,
      promoter: interpretObservedResponse('kuaishou', promoter, promoters('2'))
        .capture,
    },
    request: async (path, body) => {
      calls.push(path)
      if (path === search.path) return shops(body.pageNum)
      assert.equal(body.ext.timeRange, '30d')
      return promoters(body.ext.sellerId)
    },
    stopped: () => false,
    progress: async () => {},
  })
  assert.deepEqual(calls, [search.path, promoter.path])
  assert.deepEqual(
    talents.map((t) => t.id),
    ['1', '2']
  )
})

test('observed quota, authenticated identity and product commissions remain scoped to their known response schemas', () => {
  const identity = classifyObservedRequest(
    'kuaishou',
    'https://cps.kwaixiaodian.com/gateway/distribute/match/user/basic/login/info?type=1'
  )
  assert.deepEqual(
    interpretObservedResponse('kuaishou', identity, {
      result: 1,
      data: { userInfo: { userId: 'shop-1', userNick: '店铺一' } },
    }).account,
    { shopId: 'shop-1', shopName: '店铺一', status: 'online' }
  )
  const douyinIdentity = classifyObservedRequest(
    'douyin',
    'https://buyin.jinritemai.com/index/getUser'
  )
  assert.deepEqual(
    interpretObservedResponse('douyin', douyinIdentity, {
      code: 0,
      data: { shop_id: '0', shop_name: '' },
    }).account,
    { status: 'offline' }
  )
  assert.deepEqual(
    interpretObservedResponse('douyin', douyinIdentity, {
      code: 0,
      data: { shop_id: 'shop-2', shop_name: '店铺二' },
    }).account,
    { shopId: 'shop-2', shopName: '店铺二', status: 'online' }
  )
  const quota = classifyObservedRequest(
    'kuaishou',
    'https://cps.kwaixiaodian.com/distribute/pc/seller/invite/contact?inviteType=1'
  )
  assert.equal(
    interpretObservedResponse('kuaishou', quota, {
      result: 1,
      data: { remainingSendCnt: 12 },
    }).quota.remaining,
    12
  )
  const product = classifyObservedRequest(
    'douyin',
    'https://buyin.jinritemai.com/connection/pc/im/promotion/list?uid=talent-1&query=123'
  )
  const items = [
    { product_id: '123', orient_cos_ratio_detail: { ratio: 1000 } },
  ]
  const observed = interpretObservedResponse('douyin', product, {
    code: 0,
    data: { promotion_list: items },
  }).product
  assert.equal(observed.uid, 'talent-1')
  assert.equal(observed.query, '123')
  assert.deepEqual(observed.items, items)
})
