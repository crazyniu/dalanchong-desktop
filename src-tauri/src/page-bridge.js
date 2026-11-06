(() => {
  const platform = __DALANCHONG_PLATFORM__
  const origin = platform === 'kuaishou'
    ? 'https://cps.kwaixiaodian.com'
    : 'https://buyin.jinritemai.com'
  if (window.top !== window || location.origin !== origin) return

  const paths = platform === 'kuaishou' ? {
    '/gateway/distribute/match/common/orchestration/execute': 'search',
    '/gateway/distribute/pc/common/promoter/list': 'promoter',
    '/distribute/pc/seller/invite/contact': 'quota',
    '/gateway/distribute/match/user/basic/login/info': 'account',
  } : {
    '/square_pc_api/square/search_feed_author': 'search',
    '/connection/pc/im/shop_contact_rights_info': 'quota',
    '/connection/pc/im/promotion/list': 'product',
    '/index/getUser': 'account',
  }
  const invoke = window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__)
  const documentId = crypto.randomUUID()
  const latest = new Map()
  const ownRequests = new Map()
  let busyMask = null
  let previousInert = false
  const setBusy = (running) => {
    if (running && !busyMask) {
      previousInert = document.body.inert
      document.body.inert = true
      busyMask = document.createElement('div')
      busyMask.tabIndex = 0
      busyMask.setAttribute('role', 'status')
      busyMask.setAttribute('aria-label', '任务运行中')
      busyMask.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;background:rgba(15,23,42,.15);cursor:wait;outline:none;'
      const label = document.createElement('span')
      label.textContent = '任务运行中'
      label.style.cssText = 'padding:12px 16px;border-radius:12px;background:#fff;color:#0f172a;font:14px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.15);'
      busyMask.append(label)
      for (const event of ['pointerdown', 'click', 'contextmenu', 'keydown', 'wheel', 'touchmove']) {
        busyMask.addEventListener(event, (e) => {
          e.preventDefault()
          e.stopPropagation()
        }, { passive: false })
      }
      document.documentElement.append(busyMask)
      busyMask.focus({ preventScroll: true })
    } else if (!running && busyMask) {
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
  const sanitize = (value) => JSON.parse(JSON.stringify(value, (key, item) =>
    sensitive.test(key) ? '[已隐藏]' : typeof item === 'string' ? redactText(item) : item
  ))
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
  const report = (payload) => invoke('platform_observe', { payload }).catch(() => {})
  const current = (request) => latest.get(request.kind) === request.sequence
  const fail = (request, error) => {
    if (current(request)) report({
      request: { ...request, phase: 'complete' },
      error: redactText(error.message || error).slice(0, 8000),
    })
  }
  const begin = (value, method, rawBody, order) => {
    const url = new URL(value, location.href)
    const kind = url.origin === origin && paths[url.pathname]
    if (!kind || method === 'OPTIONS') return null
    let body = rawBody ?? null
    if (typeof body === 'string') {
      if (body.length > maxBody) return null
      try { body = body ? JSON.parse(body) : null } catch { return null }
    }
    if (kind === 'search' && (!body ||
      (platform === 'kuaishou' && body.scene !== 'distribute_peer_seller_list'))) return null
    if (kind === 'promoter' && body?.sceneCode !== 'ps_seller_coop_promoter_list') return null
    if (ownRequests.has(signature(url.pathname, body))) return null
    const request = {
      kind, path: url.pathname, url: safeUrl(url.href), method,
      body: sanitize(body), sequence: order, documentId,
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
    try { safeText = JSON.stringify(sanitize(JSON.parse(text))) }
    catch { safeText = redactText(text).slice(0, 8000) }
    report({
      request: { ...request, phase: 'complete' },
      response: { ...metadata, url: safeUrl(metadata.url), text: safeText },
    })
  }
  const readText = async (response) => {
    if (!response.body) return ''
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let length = 0
    let text = ''
    while (true) {
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
    // Clone Request bodies before dispatch, but do not await observation before fetch.
    const body = init?.body !== undefined ? Promise.resolve(init.body)
      : isRequest && method !== 'GET' && method !== 'HEAD' ? input.clone().text()
      : Promise.resolve(null)
    const observed = body.then((value) => begin(url, method, value, order))
    const result = originalFetch.apply(this, arguments)
    void result.then(async (response) => {
      // Clone immediately, before the platform consumes the original response.
      const copy = response.clone()
      const request = await observed
      if (!request) {
        if (copy.body) void copy.body.cancel()
        return
      }
      try {
        const text = await readText(copy)
        finish(request, text, {
          status: response.status, url: response.url || url,
          requestId: response.headers.get('x-tt-logid') ||
            response.headers.get('x-request-id') || response.headers.get('request-id') || '',
        })
      } catch (error) { fail(request, error) }
    }, async (error) => {
      const request = await observed
      if (request) fail(request, error)
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
    const request = meta && begin(meta.url, meta.method, body, ++sequence)
    if (request) this.addEventListener('loadend', () => {
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
