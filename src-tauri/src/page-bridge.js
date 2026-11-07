/**
 * AI module map
 * Purpose: instrument supported invitation pages without changing their request semantics.
 * Entry: browser.rs injects this IIFE at document start and substitutes the platform token.
 * Flow: observe allowlisted fetch/XHR calls, redact bounded bodies, and report pending/
 * complete observations via platform_observe; SPA URL changes use platform_route.
 * __DALANCHONG_BRIDGE__.run executes native
 * requests and returns results via platform_result; setBusy shields only collection
 * tasks from page interaction. Invitation tasks leave the page interactive.
 * State: documentId, routeRevision, and sequence select current observations; one list
 * slot is shared by every collection source. ownRequests excludes
 * application-originated fetches from the user's active search/filter capture.
 * Superseded response copies stop reading at the next stream boundary; the platform's
 * original response remains owned and consumed by the platform.
 * Invariants: run only in the matching top-level origin, clone request/response bodies,
 * and preserve original fetch/XHR outcomes. Restore prior inert state when clearing the
 * mask. Remote pages receive no local-storage, license, or update command capability.
 */

(() => {
  const platform = __DALANCHONG_PLATFORM__
  const origin = platform === 'kuaishou'
    ? 'https://cps.kwaixiaodian.com'
    : 'https://buyin.jinritemai.com'
  if (window.top !== window || location.origin !== origin) return

  const paths = platform === 'kuaishou' ? {
    '/gateway/distribute/match/common/orchestration/execute': 'list',
    '/gateway/distribute/pc/common/promoter/list': 'list',
    '/distribute/pc/seller/promoter/list': 'list',
    '/distribute/pc/seller/promoter/search/list': 'list',
    '/gateway/distribute/platform/reco/promoter': 'list',
    '/gateway/distribute/platform/promoter/ranking/query': 'list',
    '/distribute/pc/seller/invite/contact': 'quota',
    '/gateway/distribute/match/user/basic/login/info': 'account',
  } : {
    '/square_pc_api/square/search_feed_author': 'list',
    '/square_pc_api/similar_kol/list': 'list',
    '/square_pc_api/prd_2_kol/list': 'list',
    '/square_pc_api/recommend/crowd_pack_rec_author': 'list',
    '/square_pc_api/selection_square_clue/list': 'list',
    '/square_pc_api/peer/shopPeerList': 'list',
    '/square_pc_api/peer/shopCollectList': 'list',
    '/square_pc_api/rank/author/list': 'list',
    '/connection/pc/im/shop_contact_rights_info': 'quota',
    '/index/getUser': 'account',
  }
  const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
  const documentId = crypto.randomUUID()
  const latest = new Map()
  const ownRequests = new Map()
  let pageUrl = location.href
  let routeRevision = 0
  let reports = Promise.resolve()
  // Route notifications and observations share one IPC queue. A new list cannot
  // establish its capture before the native route transition clears the old one.
  const notifyRoute = () => {
    if (pageUrl === location.href) return
    pageUrl = location.href
    routeRevision += 1
    latest.delete('list')
    const route = { url: pageUrl, documentId, routeRevision }
    reports = reports.then(() => invoke('platform_route', route)).catch(() => {})
  }
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method]
    history[method] = function () {
      const result = original.apply(this, arguments)
      notifyRoute()
      return result
    }
  }
  window.addEventListener('popstate', notifyRoute)
  window.addEventListener('hashchange', notifyRoute)
  const requestPage = () => {
    notifyRoute()
    return { pageUrl, routeRevision }
  }
  const listSupported = (path, body, url) => {
    const page = new URL(url)
    if (page.origin !== origin) return false
    if (platform === 'kuaishou') {
      if (page.pathname === '/zone/daren-match/daren-square-pro') {
        return path === '/distribute/pc/seller/promoter/list'
          || (path === '/distribute/pc/seller/promoter/search/list'
            && body?.sceneCode === 'ps_seller_search_promoter_list')
          || (path === '/gateway/distribute/platform/reco/promoter'
            && [
              'ps_reco_promoter_by_select_item',
              'ps_reco_promoter_by_select_promoter',
              'ps_reco_promoter_by_seller_channel',
              'ps_reco_promoter_by_relation_sameseller',
              'ps_reco_promoter_data_raise_up',
            ].includes(body?.sceneCode))
      }
      if (page.pathname === '/zone-cps/promoter-rank-list') {
        return path === '/gateway/distribute/platform/promoter/ranking/query'
      }
      return page.pathname === '/zone/daren-match/peer-reference'
        && ((path === '/gateway/distribute/match/common/orchestration/execute'
          && body?.scene === 'distribute_peer_seller_list')
          || (path === '/gateway/distribute/pc/common/promoter/list'
            && body?.sceneCode === 'ps_seller_coop_promoter_list'))
    }
    return (page.pathname === '/dashboard/servicehall/daren-square'
      && [
        '/square_pc_api/square/search_feed_author',
        '/square_pc_api/similar_kol/list',
        '/square_pc_api/prd_2_kol/list',
        '/square_pc_api/recommend/crowd_pack_rec_author',
      ].includes(path))
      || (page.pathname === '/dashboard/servicehall/clue-daren'
        && path === '/square_pc_api/selection_square_clue/list')
      || (page.pathname === '/dashboard/servicehall/peer-reference'
        && ['/square_pc_api/peer/shopPeerList', '/square_pc_api/peer/shopCollectList'].includes(path))
      || (page.pathname === '/dashboard/ranklist/daren'
        && path === '/square_pc_api/rank/author/list')
  }
  let busyMask = null
  let previousInert = false
  const setBusy = (collecting) => {
    if (collecting && !busyMask) {
      previousInert = document.body.inert
      document.body.inert = true
      busyMask = document.createElement('div')
      busyMask.tabIndex = 0
      busyMask.setAttribute('role', 'status')
      busyMask.setAttribute('aria-label', '采集中')
      // Progress belongs to the native terminal/summary overlay; this mask only locks input.
      busyMask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(15,23,42,.15);cursor:wait;outline:none;'
      for (const event of ['pointerdown', 'click', 'contextmenu', 'keydown', 'wheel', 'touchmove']) {
        busyMask.addEventListener(event, (e) => {
          e.preventDefault()
          e.stopPropagation()
        }, { passive: false })
      }
      document.documentElement.append(busyMask)
      busyMask.focus({ preventScroll: true })
    } else if (!collecting && busyMask) {
      document.body.inert = previousInert
      busyMask.remove()
      busyMask = null
    }
  }
  const maxBody = 2 * 1024 * 1024
  let sequence = 0
  const sensitive = /cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation/i
  const redactText = (text) => String(text).replace(
    /(["']?[\w-]*(?:cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation)[\w-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>&;]+)/gi,
    '$1[已隐藏]'
  )
  const redactValue = (key, item) =>
    sensitive.test(key) ? '[已隐藏]' : typeof item === 'string' ? redactText(item) : item
  const sanitize = (value) => JSON.parse(JSON.stringify(value, redactValue))
  const safeUrl = (value) => {
    const url = new URL(value, location.href)
    for (const key of [...url.searchParams.keys()]) {
      if (sensitive.test(key)) url.searchParams.delete(key)
    }
    url.hash = ''
    url.username = ''
    url.password = ''
    return url.href
  }
  const signature = (path, body) => `${path.split('?')[0]}\n${JSON.stringify(body ?? null)}`
  // Observation failures are reported in the local UI; a failed IPC must never
  // change the return value or rejection of the platform's original request.
  const current = (request) => request.pageUrl === location.href
    && request.routeRevision === routeRevision
    && latest.get(request.kind) === request.sequence
  const report = (payload) => {
    reports = reports.then(() => current(payload.request)
      ? invoke('platform_observe', { payload }) : undefined).catch(() => {})
  }
  const fail = (request, error) => {
    if (current(request)) report({
      request: { ...request, phase: 'complete' },
      error: redactText(error.message || error).slice(0, 8000),
    })
  }
  // The pending event invalidates older observations immediately; only the matching
  // completion may establish a new active filter. App-owned calls are excluded by signature.
  const begin = (value, method, rawBody, order, page) => {
    if (page.pageUrl !== location.href || page.routeRevision !== routeRevision) return null
    const url = new URL(value, page.pageUrl)
    const kind = url.origin === origin && paths[url.pathname]
    if (!kind || method === 'OPTIONS') return null
    if (platform === 'kuaishou' && kind === 'quota' && url.searchParams.get('inviteType') !== '1') return null
    let body = rawBody ?? null
    if (typeof body === 'string') {
      if (body.length > maxBody) return null
      try { body = body ? JSON.parse(body) : null } catch { return null }
    }
    if (kind === 'list' && !listSupported(url.pathname, body, page.pageUrl)) return null
    if (ownRequests.has(signature(url.pathname, body))) return null
    const request = {
      kind, path: url.pathname, url: safeUrl(url.href), method,
      body: sanitize(body), sequence: order, documentId, ...page,
    }
    if ((latest.get(kind) || 0) >= request.sequence) return null
    latest.set(kind, request.sequence)
    report({ request: { ...request, phase: 'pending' } })
    return request
  }
  const finish = (request, text, metadata) => {
    if (!current(request)) return
    if (text.length > maxBody) {
      fail(request, Error('网页响应超过 2 MiB，未读取完整列表'))
      return
    }
    let safeText
    try { safeText = JSON.stringify(JSON.parse(text), redactValue) }
    catch { safeText = redactText(text).slice(0, 8000) }
    report({
      request: { ...request, phase: 'complete' },
      response: { ...metadata, url: safeUrl(metadata.url), text: safeText },
    })
  }
  const readText = async (response, request) => {
    if (!response.body) return ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let length = 0
    let text = ''
    while (true) {
      if (!current(request)) {
        void reader.cancel()
        return null
      }
      const { done, value } = await reader.read()
      if (done) return text + decoder.decode()
      length += value.byteLength
      if (length > maxBody) {
        void reader.cancel()
        throw Error('网页响应超过 2 MiB，未读取完整列表')
      }
      text += decoder.decode(value, { stream: true })
    }
  }
  const originalFetch = window.fetch
  window.fetch = function (input, init) {
    const isRequest = input instanceof Request
    const url = isRequest ? input.url : String(input)
    const method = String(init?.method || (isRequest ? input.method : 'GET')).toUpperCase()
    const parsed = new URL(url, location.href)
    if (parsed.origin !== origin || !paths[parsed.pathname] || method === 'OPTIONS')
      return originalFetch.apply(this, arguments)
    const order = ++sequence
    const page = requestPage()
    // Clone Request bodies before dispatch, but do not await observation before fetch.
    const body = init?.body !== undefined ? Promise.resolve(init.body)
      : isRequest && method !== 'GET' && method !== 'HEAD' ? input.clone().text()
      : Promise.resolve(null)
    let request
    const observed = body.then((value) => {
      request = begin(url, method, value, order, page)
      return request
    })
    const result = originalFetch.apply(this, arguments)
    void result.then(async (response) => {
      // App-owned and superseded requests do not need a second response stream.
      if (request === null || (request && !current(request))) return
      // Clone immediately, before the platform consumes the original response.
      const copy = response.clone()
      const captured = await observed
      if (!captured || !current(captured)) {
        if (copy.body) void copy.body.cancel()
        return
      }
      try {
        const text = await readText(copy, captured)
        if (text === null) return
        finish(captured, text, {
          status: response.status, url: response.url || url,
          requestId: response.headers.get('x-tt-logid') ||
            response.headers.get('x-request-id') || response.headers.get('request-id') || '',
        })
      } catch (error) { fail(captured, error) }
    }, async (error) => {
      const captured = await observed
      if (captured) fail(captured, error)
    }).catch(() => {})
    return result
  }

  const xhrMeta = new WeakMap()
  const xhrOpen = XMLHttpRequest.prototype.open
  const xhrSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url) {
    const result = xhrOpen.apply(this, arguments)
    xhrMeta.set(this, { method: String(method).toUpperCase(), url: String(url) })
    return result
  }
  XMLHttpRequest.prototype.send = function (body) {
    const meta = xhrMeta.get(this)
    const request = meta && begin(meta.url, meta.method, body, ++sequence, requestPage())
    if (request) this.addEventListener('loadend', () => {
      if (!current(request)) return
      if (!this.status) {
        fail(request, Error('网页请求失败或已取消'))
        return
      }
      const text = this.responseType === 'json' ? JSON.stringify(this.response)
        : this.responseType === '' || this.responseType === 'text' ? this.responseText : null
      if (text === null) {
        fail(request, Error('网页接口返回了非文本响应'))
        return
      }
      finish(request, text, {
        status: this.status, url: this.responseURL || meta.url,
        requestId: this.getResponseHeader('x-tt-logid') ||
          this.getResponseHeader('x-request-id') || this.getResponseHeader('request-id') || '',
      })
    }, { once: true })
    return xhrSend.apply(this, arguments)
  }

  Object.defineProperty(window, '__DALANCHONG_BRIDGE__', {
    value: Object.freeze({
      setBusy,
      async run(requestId, execute, request) {
        const key = request ? signature(request.path, request.body) : null
        if (key) ownRequests.set(key, (ownRequests.get(key) || 0) + 1)
        try {
          const result = await execute()
          await invoke('platform_result', { requestId, result: result ?? null })
        } catch (error) {
          await invoke('platform_result', {
            requestId, result: null, error: redactText(error.message || error).slice(0, 8000),
          })
        } finally {
          if (key) {
            const remaining = ownRequests.get(key) - 1
            if (remaining) ownRequests.set(key, remaining)
            else ownRequests.delete(key)
          }
        }
      },
    }),
  })
})()
