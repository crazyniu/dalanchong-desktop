/**
 * AI module map
 * Purpose: adapt Kuaishou/Douyin request, response, quota, collection, and invitation schemas.
 * Entry: makeApi wraps a page executor; classify/interpretObservedResponse normalize
 * captured page traffic; collect traverses candidates; prepareInvite builds one invitation.
 * Flow: serialized pageRequest runs in the authenticated account WebView, not Node or a
 * separate HTTP client. Results become normalized values or errors carrying diagnostics
 * and beforeSend/rejected/login/license/stopped flags consumed by runner.mjs and runtime.mjs.
 * Request-local onResponse callbacks receive successful HTTP/business metadata and
 * redacted, bounded response bodies without changing the parsed-data return contract.
 * Invariants: reuse only a fresh matching observed page, preserve actual website filters,
 * normalize observed quota and required commission fields, and keep collection separate
 * from sending. Invitations do not query or gate on remaining quota.
 * Collected profiles retain supported business fields only; contact payloads are omitted.
 * Collection publishes each batch immediately and retains only seen IDs for its total;
 * the caller owns durable rows. Douyin eligibility/product queries use the account
 * page's fetch; only card sends use its HTTP client and live session/security
 * interceptors. Main and small-shop webpack
 * loaders are scoped to their live chunk arrays; device values are read per send.
 * Monetary display values use yuan, and unavailable metrics remain absent rather than zero.
 * Never interpret transport uncertainty as confirmed rejection; redact and bound bodies.
 * Changing endpoint/schema logic also requires reviewing page-bridge.js and browser.rs.
 */

import { collectionPage } from './collection-pages.mjs'
export { isSupportedCollectionPage } from './collection-pages.mjs'

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
function responseBody(text, parsed) {
  let body
  try {
    body = JSON.stringify(
      parsed === undefined ? JSON.parse(text) : parsed,
      (key, value) => sensitiveKey.test(key)
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
// This function is serialized into the account page. Keep its dependencies local:
// module-scoped helpers/imports are not available inside the remote WebView realm.
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
      // Eligibility and product queries must not initialize the page's HTTP
      // client or wait on its request interceptors before issuing their fetch.
      // The current shop page and its host use separate webpack runtimes. Bind
      // each known client to its own loader; never call a main-app module ID in
      // the shop runtime or assume either exists during a verification reload.
      const loaders = window.__DALANCHONG_INVITE_LOADERS__ ||= new WeakMap()
      let pageRequire
      let requestModule
      for (const [chunks, moduleId] of [
        [window.webpackChunksmall_shop, '25663'],
        [window.webpackChunkmain, '720762'],
      ]) {
        if (!Array.isArray(chunks) || chunks.push === Array.prototype.push) continue
        let require = loaders.get(chunks)
        if (!require) {
          chunks.push([
            ['ecommerce-invite-' + crypto.randomUUID()],
            {},
            (loadedRequire) => { require = loadedRequire },
          ])
          if (!require) continue
          loaders.set(chunks, require)
        }
        // Inspect registration only; do not execute unrelated page modules.
        if (!require.m[moduleId] || !require.m['413497']) continue
        pageRequire = require
        requestModule = moduleId
        break
      }
      if (!pageRequire)
        throw Error('抖音网页模块尚未就绪，请在当前网页完成验证或打开达人页面')
      const request = pageRequire(requestModule)
      const url = new URL(path, location.origin)
      const options = {
        headers,
        params: Object.fromEntries(url.searchParams),
        // Keep non-2xx responses out of the website's error-swallowing interceptor.
        validateStatus: () => true,
      }
      // Match the website's invitation form: await its device report instead of
      // reading only getNonFxgEcomDid's cached value from an earlier page session.
      const device = await pageRequire('413497').reportNonFxgEcomDid({ appName: 'buyin' })
      if (!device?.web_did || !device.ewid)
        throw Error('设备信息未就绪，请刷新达人广场')
      const client = window.webviewBridge?.callBrowserWindow
        ? await window.webviewBridge.callBrowserWindow('getClientInfo')
        : null
      body.event_param = {
        client_form: 'pc',
        web_did: String(device.web_did),
        seraph_did: String(device.seraph_did || ''),
        x_pigeon_did: String(client?.deviceId || ''),
      }
      // reportNonFxgEcomDid updates browser storage but not the getter's private
      // cache. Use this same report for URL and body; the page client preserves
      // explicit params when adding its own device defaults.
      options.params.ewid = device.ewid
      options.params.seraph_did = device.seraph_did
      // Keep the website's session/signing hooks and verification handling.
      // Preserve HTTP/business failures for our normal parser.
      dispatched = true
      let response
      try {
        response = await request.v_(url.pathname, body, options)
      } catch (error) {
        if (!error.response) throw error
        response = error.response
      }
      if (!response.status) throw Error('平台网页请求未返回响应')
      return {
        status: response.status,
        url: response.request?.responseURL || url.href,
        text: typeof response.data === 'string'
          ? response.data
          : JSON.stringify(response.data),
        requestId: response.headers['x-tt-logid'] ||
          response.headers['x-request-id'] || response.headers['request-id'],
      }
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
  return async (path, body = null, method = body === null ? 'GET' : 'POST', onResponse) => {
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
          license: error.license === true,
          stopped: error.stopped === true,
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
    return parseApiResponse(platform, path, method, result, onResponse)
  }
}

export function parseApiResponse(platform, path, method, result, onResponse) {
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
  const message =
    data.error_msg ||
    data.errorMsg ||
    data.msg ||
    data.message
  const reason = message || '平台返回失败'
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
  onResponse?.({
    path: path.split('?')[0],
    method,
    ...detail,
    ...(message != null ? { message: redactText(message) } : {}),
    // The successful reply was parsed above; redact that value without parsing
    // the same potentially large product response again.
    body: responseBody(result.text, data),
  })
  return data
}

const quotaPaths = {
  kuaishou: '/distribute/pc/seller/invite/contact?inviteType=1',
  douyin: '/connection/pc/im/shop_contact_rights_info',
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

// A page can issue unrelated background requests. Only its own list may select
// the active collection source; all list modes share one latest-request slot.
const listSources = {
  'ks-square': {
    '/distribute/pc/seller/promoter/list': 'ks-square',
    '/distribute/pc/seller/promoter/search/list': 'ks-search',
    '/gateway/distribute/platform/reco/promoter': 'ks-recommend',
  },
  'ks-peer': {
    '/gateway/distribute/match/common/orchestration/execute': 'ks-shops',
    '/gateway/distribute/pc/common/promoter/list': 'ks-shop-authors',
  },
  'ks-rank': {
    '/gateway/distribute/platform/promoter/ranking/query': 'ks-rank',
  },
  'dy-square': {
    '/square_pc_api/square/search_feed_author': 'dy-square',
    '/square_pc_api/similar_kol/list': 'dy-similar',
    '/square_pc_api/prd_2_kol/list': 'dy-product',
    '/square_pc_api/recommend/crowd_pack_rec_author': 'dy-crowd',
  },
  'dy-clue': {
    '/square_pc_api/selection_square_clue/list': 'dy-clue',
  },
  'dy-peer': {
    '/square_pc_api/peer/shopPeerList': 'dy-shops',
    '/square_pc_api/peer/shopCollectList': 'dy-shops',
  },
  'dy-rank': {
    '/square_pc_api/rank/author/list': 'dy-rank',
  },
}
const recommendationScenes = new Set([
  'ps_reco_promoter_by_select_item',
  'ps_reco_promoter_by_select_promoter',
  'ps_reco_promoter_by_seller_channel',
  'ps_reco_promoter_by_relation_sameseller',
  'ps_reco_promoter_data_raise_up',
])
const observedPaths = {
  kuaishou: {
    '/distribute/pc/seller/invite/contact': 'quota',
    '/gateway/distribute/match/user/basic/login/info': 'account',
  },
  douyin: {
    '/connection/pc/im/shop_contact_rights_info': 'quota',
    '/index/getUser': 'account',
  },
}

export function classifyObservedRequest(platform, url, body = null, pageUrl) {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(urls[platform]).origin) return null
  const path = parsed.pathname
  const page = collectionPage(platform, pageUrl)
  const mode = listSources[page]?.[path]
  const kind = mode ? 'list' : observedPaths[platform][path]
  if (!kind) return null
  if (platform === 'kuaishou' && kind === 'quota' && parsed.searchParams.get('inviteType') !== '1')
    return null
  if (typeof body === 'string') {
    try {
      body = body ? JSON.parse(body) : null
    } catch {
      throw apiError(path, 'POST', '无法读取网页请求参数')
    }
  }
  if (mode === 'ks-shops' && body?.scene !== 'distribute_peer_seller_list') return null
  if (mode === 'ks-shop-authors' && body?.sceneCode !== 'ps_seller_coop_promoter_list') return null
  if (mode === 'ks-search' && body?.sceneCode !== 'ps_seller_search_promoter_list') return null
  if (mode === 'ks-recommend' && !recommendationScenes.has(body?.sceneCode)) return null
  const method = body === null ? 'GET' : 'POST'
  if (mode && method === 'GET') {
    // Keep business filters and pagination, letting the page regenerate signatures.
    for (const key of ['msToken', 'a_bogus', '_signature', 'fp', 'verifyFp', 'ewid', 'seraph_did'])
      parsed.searchParams.delete(key)
    body = Object.fromEntries(parsed.searchParams)
  }
  return { kind, mode, path, body, url, method, pageUrl }
}

function collectionRows(source, result) {
  switch (source.mode) {
    case 'ks-shops': return result.dataList
    case 'ks-shop-authors':
    case 'ks-recommend': return result.data?.promoterDataInfo
    case 'ks-square': return result.data?.promoterList
    case 'ks-search': return result.data?.searchPromoterInfo
    case 'ks-rank': return result.data?.data
    case 'dy-shops': return result.data?.shop_list
    case 'dy-similar':
    case 'dy-product':
    case 'dy-clue':
    case 'dy-crowd': return result.data?.author_list
    case 'dy-square':
    case 'dy-rank': return result.data?.list
  }
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
  const list = collectionRows(request, result)
  if (!Array.isArray(list))
    throw apiError(request.path, request.method, '平台未返回有效的采集列表', {
      status: metadata.status ?? 200,
      body: JSON.stringify(result),
    })
  return { capture: { ...request, response: result, responseAt: Date.now() } }
}

// Platform counts may be formatted strings. Accept one disclosed number, not a
// range or placeholder; amounts retain their disclosed yuan range.
function collectedNumber(value) {
  if (value == null) return undefined
  const match = String(value)
    .trim()
    .replace(/[,，]/g, '')
    .match(/^(\d+(?:\.\d+)?)\s*([万亿])?$/)
  if (!match) return undefined
  const multiplier =
    match[2] === '亿' ? 100_000_000 : match[2] === '万' ? 10_000 : 1
  const count = Number(match[1]) * multiplier
  return Number.isFinite(count) ? count : undefined
}

function collectedAmount(value) {
  if (value == null) return undefined
  const amount = String(value).trim()
  return /\d/.test(amount) ? `¥${amount}` : undefined
}

// Douyin sale_info ranges are already in yuan. Status 0 is a disclosed range;
// other statuses must not turn the API's placeholder zeroes into reported sales.
function douyinSaleRange(sale) {
  if (
    sale?.sale_status !== 0 ||
    sale.sale_low == null ||
    sale.sale_high == null
  )
    return undefined
  const low = sale.sale_low.toLocaleString('zh-CN')
  const high = sale.sale_high.toLocaleString('zh-CN')
  return sale.sale_low === sale.sale_high ? `¥${low}` : `¥${low}-${high}`
}

function kuaishouTalent(c, source) {
  return {
    id: String(c.promoterId),
    name: c.nickname,
    fans: collectedNumber(c.fansNum),
    avatarUrl: c.headUrl || undefined,
    gender: { M: '男', F: '女' }[c.gender],
    region: [c.promoterProvince, c.promoterCity].filter(Boolean).join('·') || undefined,
    level: c.promoterLevel || c.level || undefined,
    categories: c.hotSaleChannel,
    sales7d: collectedAmount(c.viewInfo?.distPayOrderAmt7d),
    sales30d: collectedAmount(c.viewInfo?.distPayOrderAmt30d),
    liveCount30d: collectedNumber(c.viewInfo?.relationLiveCnt30d),
    videoCount30d: collectedNumber(c.viewInfo?.relationVideoCnt30d),
    liveViews30d: collectedNumber(c.liveAvgVisitorNum ?? c.viewInfo?.PromoterLiveAvgVisitorNum30d),
    videoViews30d: collectedNumber(c.videoAvgWatchCnt ?? c.viewInfo?.PromoterSingleVideoAvgWatchCnt),
    avgLiveSales: collectedAmount(c.viewInfo?.liveAvgGmvRange ?? c.liveAvgGMVSquare ?? c.viewInfo?.PromoterLiveAvgGMV30d),
    avgVideoSales: collectedAmount(c.viewInfo?.videoAvgGmvRange ?? c.videoAvgGmvSquare ?? c.viewInfo?.PromoterSingleVideoAvgGmv),
    cooperationProducts30d: collectedNumber(c.viewInfo?.onshelfItemNum30d),
    source,
  }
}

function douyinTalent(row, source) {
  const c = row.author_base
  return {
    id: String(c.aweme_id || c.uid),
    uid: String(c.uid),
    name: c.nickname,
    fans: collectedNumber(c.fans_num),
    avatarUrl: c.avatar || undefined,
    gender: { 1: '男', 2: '女' }[c.gender],
    region: c.city || undefined,
    level: c.author_level == null ? undefined : `LV${c.author_level}`,
    categories: row.author_tag?.main_cate,
    contentType:
      row.author_tag?.author_label_rec_reasons
        ?.map((tag) => tag.reason)
        .join(' / ') || undefined,
    salesMode: row.author_sale?.main_sale_type || undefined,
    sales30d: douyinSaleRange(row.sale_info?.total_sales),
    settlement30d: douyinSaleRange(row.sale_info?.total_sales_settle),
    liveSales30d: douyinSaleRange(row.sale_info?.live_total_sales),
    videoSales30d: douyinSaleRange(row.sale_info?.video_total_sales),
    imageTextSales30d: douyinSaleRange(row.sale_info?.image_text_total_sales),
    windowSales30d: douyinSaleRange(row.sale_info?.window_total_sales),
    liveCount30d: collectedNumber(row.author_live?.all_live_num_30d),
    videoCount30d: collectedNumber(row.author_video?.all_video_num_30d),
    liveViews30d: collectedNumber(row.author_live?.watching_times),
    videoViews30d: collectedNumber(row.author_video?.watching_times),
    cooperationLevel: row.author_tag?.cooperation_level || undefined,
    replyRate: row.author_tag?.high_response_rate || undefined,
    source,
  }
}

// Peer-reference's disclosed zero bounds mean the platform's lowest bracket,
// not an exact zero. Its open upper bound is encoded as high = 0.
function douyinShopSaleRange(sale) {
  if (sale?.status !== 0) return undefined
  if (sale.low === 0 && sale.high === 0) return '¥0-500'
  if (sale.high === 0) return `¥${sale.low.toLocaleString('zh-CN')}+`
  return douyinSaleRange({
    sale_status: sale.status, sale_low: sale.low, sale_high: sale.high,
  })
}

// Peer-reference uses the platform's secure author ID. The official profile and
// IM account-check flows accept this value directly; do not treat it as a numeric ID.
function douyinShopTalent(c, shopName) {
  return {
    id: c.sec_author_id,
    uid: c.sec_author_id,
    name: c.name,
    fans: collectedNumber(c.fans_num),
    avatarUrl: c.avatar || undefined,
    level: c.level == null ? undefined : `LV${c.level}`,
    categories: c.main_cate,
    settlement30d: douyinShopSaleRange(c.sale_settle),
    cooperationProducts30d: collectedNumber(c.promotion_num),
    liveCount30d: collectedNumber(c.live_num),
    videoCount30d: collectedNumber(c.video_num),
    source: shopName,
  }
}

// Every mode keeps the website's filters and changes only its own pagination.
function collectionParameters(source, page) {
  const body = structuredClone(source.body)
  if (source.mode === 'ks-shops' || source.mode === 'ks-rank') body.pageNum = page
  else if (source.mode === 'ks-search') body.listParam.offset = (page - 1) * body.listParam.limit
  else if (source.mode === 'ks-square' || source.mode === 'ks-recommend') {
    if (body.limit != null) body.offset = (page - 1) * body.limit
  } else if (['dy-square', 'dy-similar', 'dy-product', 'dy-crowd', 'dy-clue'].includes(source.mode)) {
    body.page = page
    if (source.mode === 'dy-square' || source.mode === 'dy-similar') body.refresh = page === 1
    if (source.mode === 'dy-product') body.loadmore = page !== 1
  } else if (source.mode === 'dy-shops' || source.mode === 'dy-rank') body.page_no = page
  return body
}

function observedPageNumber(source) {
  const body = source.body
  if (source.mode === 'ks-search') return Number(body.listParam.offset) / Number(body.listParam.limit) + 1
  if (source.mode === 'ks-square' || source.mode === 'ks-recommend')
    return body.limit == null ? 1 : Number(body.offset ?? 0) / Number(body.limit) + 1
  return Number(body.pageNum ?? body.page_no ?? body.page ?? 1)
}

async function collectionResponse(source, page, request) {
  if (observedPageNumber(source) === page && Date.now() - source.responseAt < 60_000)
    return source.response
  const body = collectionParameters(source, page)
  return source.method === 'GET'
    ? request(source.path + '?' + new URLSearchParams(body))
    : request(source.path, body)
}

function collectionHasMore(source, result, page) {
  if (!collectionRows(source, result).length) return false
  const body = source.body
  switch (source.mode) {
    case 'ks-shops': return page * Number(body.pageSize) < result.total
    case 'ks-rank': return page * Number(body.pageSize) < result.data.total
    case 'ks-square':
    case 'ks-recommend': return body.limit != null && page * Number(body.limit) < result.data.total
    case 'ks-search': return page * Number(body.listParam.limit) < result.data.total
    case 'dy-square':
    case 'dy-similar':
    case 'dy-product':
    case 'dy-crowd':
    case 'dy-clue':
    case 'dy-shops': return result.data.has_more
    // The ranking page omits page_size when changing boards; its API defaults to 20.
    case 'dy-rank': return page * Number(body.page_size ?? 20) < result.data.total_num
    default: return false
  }
}

export async function collect({ platform, capture, request, stopped, progress }) {
  const source = capture.list
  if (!source) throw Error('请先在当前平台页面搜索或应用筛选')
  const unique = new Set()
  const append = async (batch, page, shopName) => {
    for (const candidate of batch) unique.add(candidate.id)
    const label = shopName ? `${shopName} · 合作达人第 ${page} 页` : `采集第 ${page} 页`
    await progress(unique.size, `${label} · ${unique.size} 位达人`, batch)
  }
  let page = 1
  let hasMore = true
  while (hasMore && !stopped()) {
    const result = await collectionResponse(source, page, request)
    const rows = collectionRows(source, result)
    if (source.mode === 'ks-shops') {
      for (const shop of rows) {
        if (stopped()) break
        const response = await request('/gateway/distribute/pc/common/promoter/list', {
          sceneCode: 'ps_seller_coop_promoter_list',
          ext: { timeRange: '7d', sortField: 'dist_pay_order_amt_7d', sellerId: String(shop.sellerId) },
        })
        const name = shop.sellerName || shop.shopName || shop.sellerNickName || String(shop.sellerId)
        await append(response.data.promoterDataInfo
          .filter((c) => !c.nickname.includes('鼠'))
          .map((c) => kuaishouTalent(c, name)), page)
      }
    } else if (source.mode === 'ks-rank') {
      await append(rows.filter((c) => !c.nickName.includes('鼠')).map((c) => ({
        id: String(c.promoterId), name: c.nickName,
        fans: collectedNumber(c.fansCount), avatarUrl: c.headUrl || undefined,
        gender: { M: '男', F: '女' }[c.gender], categories: c.mainChannelInfoTop3,
        source: '达人排行榜 · 当前榜单',
      })), page)
    } else if (platform === 'kuaishou') {
      const candidates = source.mode === 'ks-search'
        ? [...rows, ...(result.data.recoPromoterInfo || [])] : rows
      const label = source.mode === 'ks-shop-authors' ? '同行合作参考 · 当前店铺' : '达人广场'
      await append(candidates.filter((c) => !c.nickname.includes('鼠'))
        .map((c) => kuaishouTalent(c, label)), page)
    } else if (source.mode === 'dy-shops') {
      for (const shop of rows) {
        if (stopped()) break
        let authorPage = 1
        let moreAuthors = true
        while (moreAuthors && !stopped()) {
          // Shop filters select shops. Author queries use the shop page's own
          // 30-day defaults, rather than applying a shop keyword to creator names.
          const query = new URLSearchParams({
            sec_shop_id: shop.sec_shop_id, day: '30',
            page_no: String(authorPage), page_size: '20',
            query: '', log_id: '', main_cate: '', first_cate: '',
            sort_field: 'sale_settle', sort_type: '1',
          })
          const { data } = await request('/square_pc_api/shop/shopProfileAuthorList?' + query)
          await append(data.author_list.map((c) => douyinShopTalent(c, shop.name)), authorPage, shop.name)
          moreAuthors = data.has_more && data.author_list.length > 0
          authorPage++
        }
      }
    } else if (source.mode === 'dy-rank') {
      await append(rows.map((c) => ({
        id: String(c.uid), uid: String(c.uid), name: c.nickname,
        fans: collectedNumber(c.fans_num), avatarUrl: c.avatar || undefined,
        categories: c.indus_cate, source: '达人排行榜 · 当前榜单',
      })), page)
    } else if (source.mode === 'dy-clue') {
      // Intent rows wrap the same author schema used by the talent square.
      await append(rows.map((row) => douyinTalent(row.author_data, '意向带货达人')), page)
    } else if (['dy-square', 'dy-similar', 'dy-product', 'dy-crowd'].includes(source.mode)) {
      const authors = source.mode === 'dy-similar'
        ? rows.filter((row) => String(row.author_data.author_base.uid) !== String(source.body.author_id))
        : rows
      await append(authors.map((row) => douyinTalent(
        source.mode === 'dy-similar' || source.mode === 'dy-product' ? row.author_data : row,
        '达人广场'
      )), page)
    }
    hasMore = collectionHasMore(source, result, page)
    page++
  }
  return unique.size
}

// Resolve platform rules and build a send request, but do not dispatch the invitation.
// InviteRunner persists the sending record before executing the returned path/body.
// Kuaishou contact is the raw contact endpoint's data; no quota gates the send.
// Douyin's account/entry enums and no-sample/no-extra-rights choices describe this
// ordinary invitation, not browser identity. Do not replace those choices with a
// different page form's commitments; session/device/signing values belong to pageRequest.
export async function prepareInvite(
  api,
  platform,
  config,
  candidate,
  contact,
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
