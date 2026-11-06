import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import { makeApi, readQuota, urls } from '../electron/platform.mjs'

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
