export const urls = {
  kuaishou: 'https://cps.kwaixiaodian.com/zone/daren-match/peer-reference',
  douyin: 'https://buyin.jinritemai.com/dashboard/servicehall/daren-square',
}

const sensitiveKey =
  /cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation/i
function redactText(text) {
  return String(text)
    .replace(
      /(\b(?:set-cookie|cookie|authorization)\s*:)[^\r\n<]*/gi,
      '$1 [已隐藏]'
    )
    .replace(
      /(["']?[\w-]*(?:cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation)[\w-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>&;]+)/gi,
      '$1[已隐藏]'
    )
}
function responseBody(text) {
  let body
  try {
    body = JSON.stringify(JSON.parse(text), (key, value) =>
      sensitiveKey.test(key)
        ? '[已隐藏]'
        : typeof value === 'string'
          ? redactText(value)
          : value
    )
  } catch {
    body = redactText(text)
  }
  return body.length > 8000 ? body.slice(0, 8000) + '…（已截断）' : body
}
export function apiError(path, method, message, detail = {}, flags = {}) {
  const safeMessage = redactText(message)
  return Object.assign(Error(safeMessage), flags, {
    code: detail.code,
    response: {
      path: path.split('?')[0],
      method,
      ...detail,
      message: safeMessage,
      ...(detail.body !== undefined ? { body: responseBody(detail.body) } : {}),
    },
  })
}
const isLoginMessage = (message) =>
  /未登[录陆]|请.{0,4}登[录陆]|登[录陆].{0,8}(失效|过期)|not[ _-]?login|login[ _-]?required/i.test(
    message
  )

// Runs in the platform page, retaining its signing hooks and device context.
async function pageRequest(platform, path, body, method) {
  let dispatched = false
  try {
    const headers = { 'content-type': 'application/json' }
    if (platform === 'kuaishou') {
      headers.businessKey = '00635321-8464-4815-8d15-45929c610aff'
      const token = document.cookie
        .split('; ')
        .find((x) => x.startsWith('ks-s-ctn='))
      if (token) headers['ks-s-ctn'] = decodeURIComponent(token.slice(9))
    } else if (path === '/connection/pc/im/invite/card/send') {
      let sdk
      window.webpackChunkmain.push([
        ['ecommerce-device-' + crypto.randomUUID()],
        {},
        (require) => {
          sdk = require('413497')
        },
      ])
      const device = sdk.getNonFxgEcomDid()
      if (!device.web_did) throw Error('设备信息未就绪，请刷新达人广场')
      const client = window.webviewBridge?.callBrowserWindow
        ? await window.webviewBridge.callBrowserWindow('getClientInfo')
        : null
      body.event_param = {
        client_form: 'pc',
        web_did: String(device.web_did),
        seraph_did: String(device.seraph_did || ''),
        x_pigeon_did: String(client?.deviceId || ''),
      }
      path +=
        '?' +
        new URLSearchParams({
          ewid: device.ewid,
          ...(device.seraph_did ? { seraph_did: device.seraph_did } : {}),
        })
    }
    dispatched = true
    const r = await fetch(path, {
      method,
      headers,
      credentials: 'include',
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
    })
    return {
      status: r.status,
      url: r.url,
      text: await r.text(),
      requestId:
        r.headers.get('x-tt-logid') ||
        r.headers.get('x-request-id') ||
        r.headers.get('request-id') ||
        undefined,
    }
  } catch (e) {
    return { error: e.message, beforeSend: !dispatched }
  }
}

export function makeApi(contents, platform) {
  return async (path, body = null, method = body === null ? 'GET' : 'POST') => {
    if (new URL(contents.getURL()).origin !== new URL(urls[platform]).origin)
      throw apiError(
        path,
        method,
        '请先登录并打开达人邀约页面',
        {},
        {
          beforeSend: true,
          login: true,
        }
      )
    let result
    try {
      result = await contents.executeJavaScript(
        `(${pageRequest.toString()})(${JSON.stringify(platform)},${JSON.stringify(path)},${JSON.stringify(body)},${JSON.stringify(method)})`,
        { path, body }
      )
    } catch (error) {
      // A destroyed execution context does not tell us whether fetch already ran.
      throw apiError(
        path,
        method,
        `网页请求执行失败：${error.message}`,
        {},
        {
          beforeSend: error.beforeSend === true,
          login: error.login === true,
        }
      )
    }
    if (result.error)
      throw apiError(
        path,
        method,
        result.error,
        {},
        {
          beforeSend: result.beforeSend,
        }
      )
    return parseApiResponse(platform, path, method, result)
  }
}

export function parseApiResponse(platform, path, method, result) {
  let data
  try {
    data = JSON.parse(result.text)
  } catch {
    data = null
  }
  const detail = {
    status: result.status,
    body: result.text,
    code: data?.code ?? data?.result,
    requestId:
      result.requestId || data?.request_id || data?.requestId || data?.log_id,
  }
  if (
    result.status === 401 ||
    (/\/login|\/signin|\/passport/i.test(result.url) &&
      new URL(result.url).pathname !== path.split('?')[0]) ||
    /^https?:\/\/(login|passport)\./i.test(result.url)
  )
    throw apiError(path, method, '登录已失效，请重新登录', detail, {
      login: true,
    })
  if (!data || typeof data !== 'object')
    throw apiError(
      path,
      method,
      `平台未返回有效数据（HTTP ${result.status}）`,
      detail,
      { login: isLoginMessage(result.text) }
    )
  const reason =
    data.error_msg ||
    data.errorMsg ||
    data.msg ||
    data.message ||
    '平台返回失败'
  const success = platform === 'kuaishou' ? data.result === 1 : data.code === 0
  if (result.status !== 200 || !success) {
    throw apiError(
      path,
      method,
      `${reason}（${detail.code ?? result.status}）`,
      detail,
      {
        // Only codes already confirmed by the extension prove a send was rejected.
        rejected:
          platform === 'douyin' &&
          result.status === 200 &&
          [-3, -4].includes(data.code),
        login: isLoginMessage(reason),
      }
    )
  }
  return data
}

const quotaPaths = {
  kuaishou: '/distribute/pc/seller/invite/contact?inviteType=1',
  douyin: '/connection/pc/im/shop_contact_rights_info',
}

export async function readQuota(api, platform) {
  return parseQuota(platform, await api(quotaPaths[platform]))
}

export function parseQuota(platform, result) {
  const path = quotaPaths[platform]
  if (platform === 'kuaishou') {
    const contact = result.data
    const remaining = Number(contact?.remainingSendCnt)
    if (
      contact?.remainingSendCnt == null ||
      !Number.isFinite(remaining) ||
      remaining < 0
    )
      throw apiError(path, 'GET', '接口未返回有效的快手邀约额度', {
        status: 200,
        body: JSON.stringify(result),
      })
    return {
      remaining,
      limit: null,
      rows: [],
      contact,
    }
  }
  const data = result.data
  const rights = data?.online_rights?.[data.shop_gmv_type - 1]
  const invalidQuota = () =>
    apiError(path, 'GET', '接口未返回当前店铺的有效邀约额度', {
      status: 200,
      body: JSON.stringify(result),
    })
  if (!rights || !Array.isArray(data.right_list_v2)) throw invalidQuota()
  const unlocked = data.right_list_v2.some(
    (r) => r.right_name === '额外发送邀约' && r.status === 1
  )
  const rows = [
    ['l01', 'LV0–LV1'],
    ['l23', 'LV2–LV3'],
    ['l45', 'LV4–LV5'],
    ['l67', 'LV6'],
  ].map(([key, label]) => {
    const used = rights['used_' + key] + (rights['additional_used_' + key] ?? 0)
    const total =
      rights['total_' + key] +
      (unlocked ? (rights['additional_' + key] ?? 0) : 0)
    if (
      !Number.isFinite(used) ||
      !Number.isFinite(total) ||
      used < 0 ||
      total < 0
    )
      throw invalidQuota()
    return { label, used, total, remaining: Math.max(0, total - used) }
  })
  return {
    remaining: rows.reduce((n, r) => n + r.remaining, 0),
    limit: rows.reduce((n, r) => n + r.total, 0),
    rows,
  }
}

// Only platform endpoints with a known response schema are observed.
const observedPaths = {
  kuaishou: {
    '/gateway/distribute/match/common/orchestration/execute': 'search',
    '/gateway/distribute/pc/common/promoter/list': 'promoter',
    '/distribute/pc/seller/invite/contact': 'quota',
    '/gateway/distribute/match/user/basic/login/info': 'account',
  },
  douyin: {
    '/square_pc_api/square/search_feed_author': 'search',
    '/connection/pc/im/shop_contact_rights_info': 'quota',
    '/connection/pc/im/promotion/list': 'product',
    '/index/getUser': 'account',
  },
}

export function classifyObservedRequest(platform, url, body = null) {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(urls[platform]).origin) return null
  const path = parsed.pathname
  const kind = observedPaths[platform][path]
  if (!kind) return null
  if (typeof body === 'string') {
    try {
      body = body ? JSON.parse(body) : null
    } catch {
      throw apiError(path, 'POST', '无法读取网页请求参数')
    }
  }
  if (
    platform === 'kuaishou' &&
    kind === 'search' &&
    body?.scene !== 'distribute_peer_seller_list'
  )
    return null
  if (kind === 'promoter' && body?.sceneCode !== 'ps_seller_coop_promoter_list')
    return null
  if (kind === 'search' && !body) return null
  return { kind, path, body, url, method: body === null ? 'GET' : 'POST' }
}

export function interpretObservedResponse(
  platform,
  request,
  json,
  metadata = {}
) {
  const result = parseApiResponse(platform, request.path, request.method, {
    status: 200,
    url: request.url,
    ...metadata,
    text: typeof json === 'string' ? json : JSON.stringify(json),
  })
  const responseAt = Date.now()
  if (request.kind === 'quota') return { quota: parseQuota(platform, result) }
  if (request.kind === 'account') {
    const id =
      platform === 'kuaishou'
        ? result.data.userInfo.userId
        : result.data.shop_id
    const name =
      platform === 'kuaishou'
        ? result.data.userInfo.userNick
        : result.data.shop_name
    // Douyin returns code 0 with shop_id = '0' for an anonymous visitor.
    if (id == null || String(id) === '0')
      return { account: { status: 'offline' } }
    return { account: { shopId: String(id), shopName: name, status: 'online' } }
  }
  if (request.kind === 'product') {
    if (!Array.isArray(result.data?.promotion_list))
      throw apiError(request.path, request.method, '平台未返回有效的商品列表', {
        status: metadata.status ?? 200,
        body: JSON.stringify(result),
      })
    const query = new URL(request.url).searchParams
    return {
      product: {
        uid: query.get('uid'),
        query: query.get('query'),
        items: result.data.promotion_list,
        responseAt,
      },
    }
  }
  const list =
    request.kind === 'promoter'
      ? result.data?.promoterDataInfo
      : platform === 'kuaishou'
        ? result.dataList
        : result.data?.list
  if (!Array.isArray(list))
    throw apiError(request.path, request.method, '平台未返回有效的采集列表', {
      status: metadata.status ?? 200,
      body: JSON.stringify(result),
    })
  return { capture: { ...request, response: result, responseAt } }
}

function capturedPage(search, platform, page) {
  const observedPage = Number(
    platform === 'kuaishou'
      ? (search.body.pageNum ?? 1)
      : (search.body.page ?? 1)
  )
  return observedPage === page && Date.now() - search.responseAt < 60_000
    ? search.response
    : undefined
}

export async function collect({
  platform,
  capture,
  request,
  stopped,
  progress,
}) {
  const unique = new Map()
  const search = capture.search
  if (!search) throw Error('请先在平台网页搜索或应用筛选，再开始采集')
  let page = 1,
    hasMore = true
  while (hasMore && !stopped()) {
    if (platform === 'kuaishou') {
      const body = { ...search.body, pageNum: page }
      const result =
        capturedPage(search, platform, page) ||
        (await request(search.path, body))
      for (const shop of result.dataList) {
        if (stopped()) break
        const template = capture.promoter?.body || {
          sceneCode: 'ps_seller_coop_promoter_list',
          ext: { timeRange: '7d', sortField: 'dist_pay_order_amt_7d' },
        }
        const observed = capture.promoter
        const cached =
          String(observed?.body.ext.sellerId) === String(shop.sellerId) &&
          Date.now() - observed.responseAt < 60_000
            ? observed.response
            : undefined
        const data = (
          cached ||
          (await request('/gateway/distribute/pc/common/promoter/list', {
            ...template,
            ext: { ...template.ext, sellerId: String(shop.sellerId) },
          }))
        ).data.promoterDataInfo
        const batch = data
          .filter((c) => !c.nickname.includes('鼠'))
          .map((c) => ({
            id: String(c.promoterId),
            name: c.nickname,
            fans: c.fansNum,
            source:
              shop.sellerName ||
              shop.shopName ||
              shop.sellerNickName ||
              String(shop.sellerId),
          }))
        for (const candidate of batch) unique.set(candidate.id, candidate)
        await progress(
          unique.size,
          `采集第 ${page} 页 · ${unique.size} 位达人`,
          batch
        )
      }
      hasMore =
        result.dataList.length > 0 && page * body.pageSize < result.total
    } else {
      const data = (
        capturedPage(search, platform, page) ||
        (await request(search.path, {
          ...search.body,
          page,
          refresh: page === 1,
        }))
      ).data
      const batch = data.list.map((row) => {
        const c = row.author_base
        return {
          id: String(c.aweme_id || c.uid),
          uid: String(c.uid),
          name: c.nickname,
          fans: c.fans_num,
          source: '达人广场 · 当前筛选',
        }
      })
      for (const candidate of batch) unique.set(candidate.id, candidate)
      hasMore = data.has_more && data.list.length > 0
      await progress(
        unique.size,
        `采集第 ${page} 页 · ${unique.size} 位达人`,
        batch
      )
    }
    page++
  }
  return [...unique.values()]
}

export async function prepareInvite(
  api,
  platform,
  config,
  candidate,
  quota,
  tags
) {
  const productIds = [
    ...new Set(
      config.products
        .trim()
        .split(/[\s,，、;；]+/)
        .filter(Boolean)
    ),
  ]
  if (platform === 'kuaishou') {
    const contact = quota.contact
    const phone = config.phone.trim() || contact.phoneNumber
    const wechat = config.wechat.trim() || contact.wechatId
    if (!contact.inviteContactName || !phone || !wechat)
      throw Error('请在快手后台完善邀约联系人、手机号及微信号')
    return {
      path: '/distribute/pc/seller/invite/seller/create',
      body: {
        promoterId: candidate.id,
        itemIdList: productIds,
        canRealUpdatePrice: 2,
        inviteContactName: contact.inviteContactName,
        phoneNumber: phone,
        wechatId: wechat,
        inviteDesc: config.message.trim(),
        sellerServiceType: tags.map((t) => t.tagId),
        inviteTagList: tags.map((t) => ({
          tagId: t.tagId,
          tagTitle: t.tagTitle,
          tagType: t.tagType,
          selected: 1,
        })),
      },
    }
  }
  const check = (
    await api(
      '/connection/pc/im/account_check?' +
        new URLSearchParams({
          account_id: candidate.uid,
          account_type: '1',
          account_app_id: '1128',
        })
    )
  ).data
  if (
    !check.is_passed ||
    check.connection_type !== 1 ||
    check.need_strong_template
  )
    return {
      skip:
        check.popwindow_text ||
        (check.connection_type === 0
          ? '可直接沟通，无需首次邀约卡片'
          : '当前达人不支持普通首次邀约'),
    }
  const settings = []
  for (const id of productIds) {
    const list = (
      await api(
        '/connection/pc/im/promotion/list?' +
          new URLSearchParams({
            page_size: '20',
            cursor: '0',
            uid: candidate.uid,
            query: id,
          })
      )
    ).data.promotion_list
    const product = list.find((p) => p.product_id === id)
    if (!product) return { skip: `商品 ${id} 不在该达人可带范围内` }
    settings.push({
      product_id: id,
      author_sample_status: 0,
      orient_cos_ratio_detail: product.orient_cos_ratio_detail ?? {},
    })
  }
  return {
    path: '/connection/pc/im/invite/card/send',
    body: {
      account_id: candidate.uid,
      account_type: 1,
      entry_point: 1,
      invite_card: {
        content: config.message.trim(),
        rights: [],
        product_ids: productIds,
        product_setting: settings,
        is_open_feed: false,
      },
      contact_info: {
        phone: config.phone.trim(),
        wechat: config.wechat.trim(),
      },
      event_param: { client_form: 'pc' },
    },
  }
}
