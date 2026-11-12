/**
 * AI module map
 * Purpose: isolated-world original/current download controls with verified file sizes.
 * Entry: manifest injection; DETAIL_INFO reads metadata and DETAIL_DOWNLOAD queues it.
 * Flow: the active Douyin work uses modal_id, vid, then pathname, including search overlays.
 * Position/quality observations maintain identity only; pointer entry or focus reads
 * just that button's size. Revision keys discard stale metadata after source changes.
 * Controls follow the rendered video image, including object-fit letterboxing;
 * an offscreen image corner hides them instead of pinning them to the viewport.
 * Background promises share source resolution between metadata and explicit downloads.
 * State: this document owns controls, the position timer and short-lived action status.
 * Boundary: source extraction and jobs stay in the background; missing replies are
 * protocol errors, never a successful download or a reason to invent a file size.
 * Diagnostics: request IDs link page Console entries to background failure stages;
 * playback URLs, cookies and platform response bodies are never logged.
 */
(() => {
  const host = document.createElement('div');
  host.dataset.dalanchongDetailControls = '';
  const shadow = host.attachShadow({mode: 'closed'});
  shadow.innerHTML = `<style>
    :host{position:fixed;z-index:2147483647;display:none;width:max-content;transform:translateX(-100%);pointer-events:none}
    .buttons{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
    button{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;max-width:100%;font:14px system-ui;color:#fff;background:#18181be6;border:1px solid #ffffff40;border-radius:8px;padding:9px 12px;cursor:pointer;white-space:nowrap;pointer-events:auto}
    button:hover{background:#27272a}button:focus-visible{outline:2px solid #fff;outline-offset:2px}
    button:disabled{opacity:.6;cursor:wait}.size{color:#d4d4d8;font-variant-numeric:tabular-nums}.size:empty{display:none}
    p{position:absolute;right:0;top:100%;margin:8px 0 0;max-width:340px;background:#18181b;color:white;border-radius:6px;padding:8px;font:14px system-ui}p:empty{display:none}
  </style><div class="buttons"><button data-quality="original"><span class="label">下载原画</span><span class="size"></span></button><button data-quality="current"><span class="label">下载当前清晰度</span><span class="size"></span></button></div><p role="status"></p>`;
  document.documentElement.append(host);
  const status = shadow.querySelector('p');
  const buttons = [...shadow.querySelectorAll('button')];
  let noticeTimer, activePage = '', playbackKey = '', canReadInfo = false;
  const sizeText = bytes => bytes >= 1000 ** 3 ? `${(bytes / 1000 ** 3).toFixed(2)} GB` : bytes >= 1000 ** 2 ? `${(bytes / 1000 ** 2).toFixed(1)} MB` : bytes >= 1000 ? `${(bytes / 1000).toFixed(1)} KB` : `${bytes} B`;
  const label = button => button.dataset.quality === 'original' ? '下载原画' : '下载当前清晰度';
  function notice(text) {
    status.textContent = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { status.textContent = ''; }, 5000);
  }
  async function send(type, button) {
    const request = {type, requestId: crypto.randomUUID(), quality: button.dataset.quality, pageUrl: activePage, playbackKey};
    const playback = playbackKey ? JSON.parse(playbackKey) : [];
    const context = {requestId: request.requestId, time: new Date().toISOString(), type,
      pageUrl: request.pageUrl, workId: request.pageUrl.match(/\/(?:video|short-video)\/([^/]+)/)?.[1],
      quality: request.quality, qualityLabel: label(button),
      playback: {sourceType: playback[0]?.split(':')[0] || 'none', width: playback[1], height: playback[2]}};
    const operation = type === 'DETAIL_INFO' ? '读取视频信息' : '下载视频';
    const started = performance.now();
    let stage = '连接插件后台';
    console.info(`[大懒虫视频] ${operation}开始`, context);
    try {
      const response = await chrome.runtime.sendMessage(request);
      stage = '读取后台响应';
      if (!response || (response.ok !== true && !response.error)) throw new Error('插件后台未响应，请重新加载插件并刷新网页。');
      if (response.error) {
        const error = new Error(response.error);
        error.code = response.code;
        error.diagnostic = response.diagnostic;
        throw error;
      }
      console.info(`[大懒虫视频] ${operation}完成`, {...context, durationMs: Math.round(performance.now() - started),
        size: response.size, sizeVerified: response.sizeVerified, jobId: response.jobId, diagnostic: response.diagnostic});
      return response;
    } catch (error) {
      const failedStage = error.diagnostic?.stage || stage;
      const cdn = error.diagnostic?.cdn;
      const network = [cdn?.origin, cdn?.networkError].filter(Boolean).join('｜');
      console.error(`[大懒虫视频] ${operation}失败｜${context.qualityLabel}｜${failedStage}｜${error.message}${network ? `｜${network}` : ''}`,
        {...context, durationMs: Math.round(performance.now() - started), stage: failedStage,
          message: error.message, stack: error.stack, diagnostic: error.diagnostic});
      if (/Extension context invalidated/.test(error.message)) throw new Error('插件连接已失效，请刷新当前网页。');
      if (/Receiving end does not exist/.test(error.message)) throw new Error('插件后台未响应，请重新加载插件并刷新网页。');
      throw error;
    }
  }
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message.type === 'DETAIL_CDN_UPDATE') {
      const diagnostic = message.diagnostic;
      const result = diagnostic.event === 'resolved' ? '已确认' : diagnostic.event === 'refreshing' ? '不可用，重新获取' : '获取失败';
      const log = diagnostic.event === 'resolved' ? console.info : console.warn;
      log(`[大懒虫视频] 原画节点${result}｜第 ${diagnostic.attempt} 次｜${diagnostic.workId}`, diagnostic);
      return;
    }
    if (message.type !== 'DETAIL_NETWORK_ERROR') return;
    const diagnostic = message.diagnostic;
    const quality = diagnostic.quality === 'original' ? '原画' : '当前清晰度';
    console.error(`[大懒虫视频] CDN 网络错误｜${quality}｜${diagnostic.workId}｜${diagnostic.cdn.origin}｜${diagnostic.cdn.networkError}`,
      diagnostic);
  });
  function showSize(button, info) {
    button.querySelector('.size').textContent = info.sizeVerified && info.size > 0 ? sizeText(info.size) : '大小未知';
  }
  async function updateSize(button, key) {
    button.dataset.infoKey = key;
    button.querySelector('.size').textContent = '读取大小…';
    button.title = '';
    try {
      const info = await send('DETAIL_INFO', button);
      if (button.dataset.infoKey === key) showSize(button, info);
    } catch (error) {
      if (button.dataset.infoKey !== key) return;
      button.querySelector('.size').textContent = '读取失败';
      button.title = error.message;
    }
  }
  for (const button of buttons) {
    const readInfo = () => {
      position();
      const key = button.dataset.mediaKey;
      if (canReadInfo && key && button.dataset.infoKey !== key) void updateSize(button, key);
    };
    button.addEventListener('pointerenter', readInfo);
    button.addEventListener('focus', readInfo);
    button.onclick = async event => {
      event.stopPropagation();
      // Refresh the route/player key synchronously before using cached metadata.
      position();
      const key = button.dataset.mediaKey;
      if (!activePage || !key) return;
      button.dataset.infoKey = key;
      button.querySelector('.size').textContent = '读取大小…';
      button.title = '';
      button.disabled = true;
      button.querySelector('.label').textContent = '正在下载…';
      try {
        const info = await send('DETAIL_DOWNLOAD', button);
        if (button.dataset.infoKey === key) showSize(button, info);
        if (button.dataset.mediaKey === key) notice('已开始下载');
      } catch (error) {
        if (button.dataset.mediaKey === key) {
          button.querySelector('.size').textContent = '读取失败';
          button.title = error.message;
          notice(error.message);
        }
      } finally {
        button.disabled = false;
        button.querySelector('.label').textContent = label(button);
      }
    };
  }
  function videoImageRect(video) {
    if (!video.videoWidth || !video.videoHeight) return null;
    const rect = video.getBoundingClientRect();
    const style = getComputedStyle(video);
    let width = rect.width, height = rect.height;
    if (style.objectFit !== 'fill') {
      const contain = Math.min(rect.width / video.videoWidth, rect.height / video.videoHeight);
      const scale = style.objectFit === 'cover'
        ? Math.max(rect.width / video.videoWidth, rect.height / video.videoHeight)
        : style.objectFit === 'none' ? 1
        : style.objectFit === 'scale-down' ? Math.min(1, contain) : contain;
      width = video.videoWidth * scale;
      height = video.videoHeight * scale;
    }
    const [x, y] = style.objectPosition.split(' ');
    const offset = (value, space) => value.endsWith('%') ? space * parseFloat(value) / 100 : parseFloat(value);
    const left = rect.left + offset(x, rect.width - width);
    const top = rect.top + offset(y, rect.height - height);
    // Cover/none may paint outside the element; only its clipped image is visible.
    return {left: Math.max(rect.left, left), top: Math.max(rect.top, top),
      right: Math.min(rect.right, left + width), bottom: Math.min(rect.bottom, top + height)};
  }
  function position() {
    const douyin = location.hostname === 'www.douyin.com';
    const params = new URLSearchParams(location.search);
    const id = params.get('modal_id') || params.get('vid') || location.pathname.match(/^\/video\/(\d+)/)?.[1];
    const detail = douyin ? /^\d+$/.test(id || '') : /^\/short-video\/[^/]+\/?$/.test(location.pathname);
    const video = detail ? [...document.querySelectorAll('video')].filter(v => {
      const rect = v.getBoundingClientRect();
      return rect.width > 100 && rect.height > 100 && rect.bottom > 0 && rect.top < innerHeight &&
        rect.right > 0 && rect.left < innerWidth;
    }).sort((a, b) => Number(a.paused) - Number(b.paused) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] : null;
    activePage = detail ? douyin ? `https://www.douyin.com/video/${id}` : location.origin + location.pathname : '';
    playbackKey = video ? JSON.stringify([video.currentSrc || video.src, video.videoWidth, video.videoHeight]) : '';
    canReadInfo = Boolean(video?.videoWidth);
    // The MAIN helper publishes only player identity, synchronously. This hint
    // refreshes presentation; the worker independently resolves the actual URL.
    let qualityKey = '';
    if (video && location.hostname === 'www.douyin.com') {
      document.dispatchEvent(new Event('dalanchong-read-current-quality'));
      qualityKey = document.documentElement.dataset.dalanchongCurrentQuality || '';
    }
    const fullscreen = document.fullscreenElement;
    const parent = video && fullscreen && fullscreen.tagName !== 'VIDEO' && fullscreen.contains(video) ? fullscreen : document.documentElement;
    if (host.parentElement !== parent) parent.append(host);
    const rect = video && videoImageRect(video);
    const visible = rect && rect.top >= 0 && rect.top < innerHeight && rect.bottom > rect.top &&
      rect.right > 0 && rect.right <= innerWidth && rect.right > rect.left;
    host.style.display = visible ? 'block' : 'none';
    if (visible) {
      host.style.top = `${rect.top + 16}px`;
      host.style.left = `${rect.right - 16}px`;
      host.style.maxWidth = `${rect.right - rect.left - 32}px`;
    }
    for (const button of buttons) {
      const key = video ? `${activePage}:${button.dataset.quality === 'current' ? `${playbackKey}:${qualityKey}` : ''}` : '';
      if (button.dataset.mediaKey !== key) {
        button.dataset.mediaKey = key;
        delete button.dataset.infoKey;
        button.querySelector('.size').textContent = '';
        button.title = '';
        clearTimeout(noticeTimer);
        status.textContent = '';
      }
    }
  }
  new ResizeObserver(position).observe(document.documentElement);
  document.addEventListener('scroll', position, true);
  document.addEventListener('fullscreenchange', position);
  document.addEventListener('loadedmetadata', position, true);
  setInterval(position, 500);
  position();
})();
