/**
 * AI module map
 * Purpose: module service-worker entry for platform analysis and shared-link parsing.
 * Entry: imports commerce/capture/preview background modules and library.js; handles DETAIL_INFO, DETAIL_DOWNLOAD and PARSE_URL runtime requests.
 * Flow: share redirects supply work IDs; batch and detail requests read those works in existing platform page MAIN worlds. Batch requests try API-provided complete-video qualities when original resolution fails. Both paths save formats through addMedia.
 * State: request-scoped parse progress lives in chrome.storage.session; detail resolutions and original-file probes are held in memory.
 * Invariants: original probes serialize per tab; unavailable CDN chains trigger at most three fresh platform resolutions without changing quality or inventing hosts. webRequest observes every redirect; only a verified final URL is saved. Batch requests never navigate source tabs.
 * Side effects: tab/script operations, platform HTTP requests, session storage, and download requeueing.
 */
import './commerce-background.js';
import './shop-label-background.js';
import './capture-background.js';
import './preview-background.js';
import {addMedia, queueDownloads} from './library.js';
import {videoPage, detailPageURL} from './platforms.js';
import {probeMediaFile} from './media.js';
import {resolveVideoURL} from './resolve.js';
import {listenMessages} from './messages.js';

const pendingProbes = new Map();
const originalProbeQueues = new Map();
const pendingMediaDiagnostics = new Map();
const mediaRequestDiagnostics = new Map();

const markDiagnostic = (diagnostic, stage, details = {}) => {
  if (diagnostic) Object.assign(diagnostic, {stage}, details);
};
const mediaOrigin = value => value ? new URL(value).origin : null;
const diagnosticText = value => String(value || '')
  .replace(/https?:\/\/[^\s"'<>]+/g, value => new URL(value).origin)
  .replace(/<[^\n]*/g, '[HTML 内容已省略]');
function playerDiagnostic(key) {
  const [source, width, height] = JSON.parse(key || '[]');
  return {sourceOrigin: mediaOrigin(source), width, height};
}
function sourceDiagnostic(source) {
  const identity = source.currentIdentity;
  return {origin: mediaOrigin(source.url), player: identity && {
    awemeId: identity.awemeId, width: identity.width, height: identity.height,
    definitionId: identity.definitionId, gearName: identity.gearName,
    qualityType: identity.qualityType, vtype: identity.vtype,
    sourceOrigin: mediaOrigin(identity.source)
  }};
}

// Retain request-ID snapshots until Chrome reports the terminal network event:
// fetch rejection can run before onErrorOccurred, after the URL subscription ends.
const mediaRequestFilter = {urls: ['http://*/*', 'https://*/*']};
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId !== -1 || details.initiator !== chrome.runtime.getURL('').slice(0, -1)) return;
  const pending = pendingMediaDiagnostics.get(details.url);
  if (pending) mediaRequestDiagnostics.set(details.requestId, {url: details.url, subscribers: new Set(pending)});
}, mediaRequestFilter);
chrome.webRequest.onBeforeRedirect.addListener(details => {
  const tracked = mediaRequestDiagnostics.get(details.requestId);
  if (!tracked) return;
  for (const {cdn} of tracked.subscribers) {
    (cdn.redirects ||= []).push({origin: mediaOrigin(details.url), httpStatus: details.statusCode,
      nextOrigin: mediaOrigin(details.redirectUrl)});
    cdn.origin = mediaOrigin(details.redirectUrl);
  }
}, mediaRequestFilter);
chrome.webRequest.onErrorOccurred.addListener(details => {
  const tracked = mediaRequestDiagnostics.get(details.requestId);
  mediaRequestDiagnostics.delete(details.requestId);
  if (!tracked || details.error === 'net::ERR_ABORTED') return;
  for (const {diagnostic, cdn, originalAttempt} of tracked.subscribers) {
    Object.assign(cdn, {origin: mediaOrigin(details.url), networkError: details.error});
    for (const request of diagnostic.requests || []) {
      const report = {...diagnostic, ...request, stage: 'cdn_request', originalAttempt, cdn};
      void chrome.tabs.sendMessage(request.tabId, {type: 'DETAIL_NETWORK_ERROR', diagnostic: report}).catch(() => {});
    }
  }
}, mediaRequestFilter);
chrome.webRequest.onCompleted.addListener(details => {
  mediaRequestDiagnostics.delete(details.requestId);
}, mediaRequestFilter);

function awemeId(url) {
  const parsed = new URL(url);
  if (parsed.origin !== "https://www.douyin.com") throw new Error("请在抖音视频页打开插件。 ");
  const id = parsed.searchParams.get("modal_id") || parsed.searchParams.get("vid") || parsed.pathname.match(/^\/video\/(\d+)/)?.[1];
  if (!/^\d+$/.test(id || "")) throw new Error("请先打开一个抖音视频或搜索结果中的视频。");
  return id;
}

// Observe redirects in the browser network layer because page scripts cannot read cross-origin CDN responses.
chrome.webRequest.onBeforeRedirect.addListener(details => {
  const pending = pendingProbes.get(details.tabId);
  if (!pending) return;
  const params = new URL(details.url).searchParams;
  if (params.get("video_id") !== pending.videoId || params.get("ratio") !== "default") return;
  markDiagnostic(pending.diagnostic, 'original_redirect', {redirect: {
    httpStatus: details.statusCode, origin: mediaOrigin(details.redirectUrl)
  }});
  if (!/^https?:\/\//.test(details.redirectUrl)) {
    pending.reject(new Error("原片接口未返回可下载的视频地址，可能需要先完成抖音验证。"));
    return;
  }
  pending.resolve({url: details.redirectUrl, playUrl: details.url});
}, {urls: ["https://www.douyin.com/aweme/v1/play/*"]});

async function inPage(tabId, func, args = []) {
  const [execution] = await chrome.scripting.executeScript({target: {tabId}, world: "MAIN", func, args});
  if (execution.result?.error) throw new Error(execution.result.error);
  return execution.result;
}

function probeOriginal(tabId, detail, diagnostic) {
  // Detail metadata and batch parsing share one page-side probe slot. Finish its
  // cleanup before the next request can install a redirect observer for this tab.
  const previous = originalProbeQueues.get(tabId) || Promise.resolve();
  const probe = previous.catch(() => {}).then(() => runOriginalProbe(tabId, detail, diagnostic));
  originalProbeQueues.set(tabId, probe);
  return probe.finally(() => {
    if (originalProbeQueues.get(tabId) === probe) originalProbeQueues.delete(tabId);
  });
}

async function runOriginalProbe(tabId, detail, diagnostic) {
  let timer;
  const redirect = new Promise((resolve, reject) => {
    pendingProbes.set(tabId, {videoId: detail.videoId, resolve, reject, diagnostic});
    timer = setTimeout(() => reject(new Error("原片探测超时：未收到视频地址。请确认视频能正常播放，再重试。")), 12000);
  });
  // Attach rejection handling before injection so an injection failure does not leave an unhandled promise.
  redirect.catch(() => {});
  try {
    markDiagnostic(diagnostic, 'original_probe_start', {videoId: detail.videoId});
    await inPage(tabId, (videoId, needCookie) => {
      window.__douyinOriginal.startProbe(videoId, needCookie);
    }, [detail.videoId, detail.needCookie]);
    if (diagnostic?.stage === 'original_probe_start') markDiagnostic(diagnostic, 'original_probe_redirect');
    return await redirect;
  } finally {
    clearTimeout(timer);
    pendingProbes.delete(tabId);
    await inPage(tabId, () => window.__douyinOriginal.stopProbe()).catch(() => {});
  }
}

async function inspectMedia(url, {credentials = 'omit', cache = 'default', diagnostic} = {}) {
  // Platform CDN responses may use octet-stream. The shared probe checks MP4
  // bytes instead of rejecting a complete video solely on its MIME label.
  markDiagnostic(diagnostic, 'cdn_request', {cdn: {origin: mediaOrigin(url)}});
  const subscribers = pendingMediaDiagnostics.get(url) || new Set();
  const subscription = diagnostic && {diagnostic, cdn: diagnostic.cdn, originalAttempt: diagnostic.originalAttempt};
  if (subscription) {
    subscribers.add(subscription);
    pendingMediaDiagnostics.set(url, subscribers);
    for (const tracked of mediaRequestDiagnostics.values()) {
      if (tracked.url === url) tracked.subscribers.add(subscription);
    }
  }
  try {
    const media = await probeMediaFile(url, {trustedVideo: true, credentials, cache});
    if (diagnostic) Object.assign(diagnostic.cdn, {origin: mediaOrigin(media.url), httpStatus: media.httpStatus,
      contentType: media.contentType, size: media.size, sizeVerified: media.sizeVerified});
    markDiagnostic(diagnostic, 'cdn_check');
    return media;
  } catch (error) {
    if (error.mediaResponse) {
      if (diagnostic) Object.assign(diagnostic.cdn, error.mediaResponse);
      markDiagnostic(diagnostic, 'cdn_check');
    }
    throw error;
  } finally {
    subscribers.delete(subscription);
    if (!subscribers.size) pendingMediaDiagnostics.delete(url);
  }
}

function reportOriginalNode(diagnostic, event, attempt) {
  const report = {workId: diagnostic.workId, event, attempt, attempts: diagnostic.originalAttempts};
  const log = event === 'resolved' ? console.info : console.warn;
  log('[大懒虫视频] 原画节点', report);
  for (const request of diagnostic.requests || []) {
    void chrome.tabs.sendMessage(request.tabId, {type: 'DETAIL_CDN_UPDATE',
      diagnostic: {...report, requestId: request.requestId}}).catch(() => {});
  }
}

async function resolveOriginalMedia(tabId, detail, diagnostic) {
  const attempts = [];
  diagnostic.originalAttempts = attempts;
  // A failed delivery node needs a new platform scheduling response, not a
  // rewritten CDN host or a bitrate-list URL that changes the requested quality.
  for (let attempt = 1; attempt <= 3; attempt++) {
    markDiagnostic(diagnostic, 'original_probe_queue', {originalAttempt: attempt});
    const address = await probeOriginal(tabId, detail, diagnostic);
    try {
      const media = await inspectMedia(address.url, {cache: 'no-store', diagnostic});
      attempts.push({attempt, redirect: diagnostic.redirect, cdn: diagnostic.cdn});
      reportOriginalNode(diagnostic, 'resolved', attempt);
      return {...media, playUrl: address.playUrl};
    } catch (error) {
      attempts.push({attempt, redirect: diagnostic.redirect, cdn: diagnostic.cdn,
        message: diagnosticText(error.message)});
      const status = error.mediaResponse?.httpStatus;
      const unavailable = error.name === 'TypeError' || error.name === 'TimeoutError' ||
        status === 403 || status === 404 || status === 410 || status >= 500;
      if (!unavailable || attempt === 3) {
        reportOriginalNode(diagnostic, 'failed', attempt);
        if (unavailable) throw new Error(`原画节点连续 ${attempt} 次不可用：${error.message}`);
        throw error;
      }
      reportOriginalNode(diagnostic, 'refreshing', attempt);
    }
  }
}

async function inspectCurrentSource(source, diagnostic) {
  const urls = [...new Set([source.url, ...(source.urls || [])])];
  const attempts = [];
  let failure;
  for (const url of urls) {
    try {
      const media = await inspectMedia(url, {diagnostic});
      attempts.push({...diagnostic.cdn});
      markDiagnostic(diagnostic, 'cdn_check', {cdnAttempts: attempts, candidateCount: urls.length});
      return media;
    } catch (error) {
      failure = error;
      attempts.push({...diagnostic.cdn, message: diagnosticText(error.message)});
    }
  }
  markDiagnostic(diagnostic, diagnostic.stage, {cdnAttempts: attempts, candidateCount: urls.length});
  throw failure;
}

async function readDouyinMedia(tabId, id, onProgress, allowAvailable = false, diagnostic = {}) {
  markDiagnostic(diagnostic, 'main_injection');
  await chrome.scripting.executeScript({target: {tabId}, world: "MAIN", files: ["page.js"]});
  markDiagnostic(diagnostic, 'detail_read', {workId: id});
  const {formats, ...detail} = await inPage(tabId, async id => {
    try { return await window.__douyinOriginal.getDetail(id); }
    catch (error) { return {error: error.message}; }
  }, [id]);
  markDiagnostic(diagnostic, 'detail_read', {detail: {
    videoId: detail.videoId, width: detail.width, height: detail.height, formatCount: formats.length
  }});
  await onProgress({message: "正在探测原片地址…"});
  try {
    if (!detail.videoId) throw new Error("详情中没有视频内部 ID，无法探测原片。 ");
    const media = await resolveOriginalMedia(tabId, detail, diagnostic);
    return {...detail, ...media, fetchedAt: Date.now(),
      quality: '原片候选', kind: 'video', sourceUrl: `https://www.douyin.com/video/${id}`, sourceTabId: tabId,
      height: Math.min(detail.width, detail.height) || detail.width || detail.height || 0};
  } catch (originalError) {
    if (!allowAvailable) throw originalError;
    await onProgress({message: '原片解析失败，正在读取可用清晰度…'});
    let failure = new Error('详情未返回完整视频地址。');
    const attempted = new Set();
    for (const format of formats) {
      for (const url of format.urls) {
        if (attempted.has(url)) continue;
        attempted.add(url);
        try {
          const media = await inspectMedia(url);
          return {...detail, ...media, fetchedAt: Date.now(), quality: format.quality,
            width: format.width, height: format.height,
            sourceUrl: `https://www.douyin.com/video/${id}`, sourceTabId: tabId};
        } catch (error) { failure = error; }
      }
    }
    throw new Error(`${originalError.message}；可用清晰度解析失败：${failure.message}`);
  }
}

async function resolveBatchWork(id, onProgress, allowAvailable = true) {
  const tabs = (await chrome.tabs.query({url: 'https://www.douyin.com/*'})).filter(tab => !tab.discarded);
  tabs.sort((a, b) => Number(videoPage(b.url)?.id === id) - Number(videoPage(a.url)?.id === id)
    || (b.lastAccessed || 0) - (a.lastAccessed || 0));
  const tab = tabs[0];
  if (!tab) throw new Error('请先在当前浏览器打开一个抖音网页并完成登录，再解析视频。');
  await onProgress({sourceTabId: tab.id});
  return addMedia(await readDouyinMedia(tab.id, id, onProgress, allowAvailable));
}

async function analyze(tabId, diagnostic) {
  markDiagnostic(diagnostic, 'page_check');
  const tab = await chrome.tabs.get(tabId);
  const id = awemeId(tab.url);
  const media = await readDouyinMedia(tabId, id, async () => {}, false, diagnostic);
  markDiagnostic(diagnostic, 'page_check_after_detail');
  const current = await chrome.tabs.get(tabId);
  if (awemeId(current.url) !== id) throw new Error("页面已切换到另一个作品，请重新获取。 ");
  return media;
}

// Keep one original/current resolution per document. Metadata and clicks share the
// same promise, so rendering a file size does not start a second original probe.
const detailMedia = new Map();
async function prepareDetail(tab, quality, playbackKey, currentSource, diagnostic) {
  markDiagnostic(diagnostic, 'page_check');
  const page = new URL(tab.url);
  const douyin = Boolean(videoPage(page));
  const kuaishou = page.hostname === 'www.kuaishou.com' && /^\/short-video\/[^/]+\/?$/.test(page.pathname);
  if (!douyin && !kuaishou) throw new Error('请打开视频详情页。');
  let item;
  if (douyin && quality === 'original') {
    item = await analyze(tab.id, diagnostic);
  } else {
    markDiagnostic(diagnostic, quality === 'current' ? 'current_quality_read' : 'work_format_read');
    const source = currentSource || await inPage(tab.id, async (quality, douyin) => {
      try {
        return douyin ? await window.__douyinOriginal.getCurrent() : window.__dalanchongDetail.read(quality);
      } catch (error) { return {error: error.message}; }
    }, [quality, douyin]);
    markDiagnostic(diagnostic, quality === 'current' ? 'current_quality_read' : 'work_format_read', {currentSource: sourceDiagnostic(source)});
    const media = await inspectCurrentSource(source, diagnostic);
    item = {...source, ...media, sourceUrl: tab.url, sourceTabId: tab.id, quality: quality === 'original' ? '原画' : '当前清晰度'};
  }
  await requireDetailPage(tab.id, page, quality, playbackKey, currentSource?.url, diagnostic);
  markDiagnostic(diagnostic, 'library_save');
  return addMedia(item);
}

async function requireDetailPage(tabId, page, quality, playbackKey, sourceUrl, diagnostic) {
  markDiagnostic(diagnostic, 'page_check_before_download');
  const current = new URL((await chrome.tabs.get(tabId)).url);
  markDiagnostic(diagnostic, 'page_check_before_download', {currentPageUrl: detailPageURL(current)});
  if (detailPageURL(current) !== detailPageURL(page)) throw new Error('页面已切换，请重新下载当前作品。');
  if (quality === 'current') {
    markDiagnostic(diagnostic, 'playback_check', {expectedPlayer: playerDiagnostic(playbackKey)});
    const key = await inPage(tabId, () => {
      const video = [...document.querySelectorAll('video')].filter(v => {
        const rect = v.getBoundingClientRect();
        return rect.width > 100 && rect.height > 100 && rect.bottom > 0 && rect.top < innerHeight &&
          rect.right > 0 && rect.left < innerWidth;
      }).sort((a, b) => Number(a.paused) - Number(b.paused) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      return video ? JSON.stringify([video.currentSrc || video.src, video.videoWidth, video.videoHeight]) : '';
    });
    markDiagnostic(diagnostic, 'playback_check', {actualPlayer: playerDiagnostic(key)});
    if (key !== playbackKey) throw new Error('播放清晰度已切换，请重新下载。');
    if (sourceUrl) {
      const source = await readCurrentSource(tabId, page.hostname === 'www.douyin.com', diagnostic);
      markDiagnostic(diagnostic, 'playback_source_check', {currentSource: sourceDiagnostic(source), sourceMatches: source.url === sourceUrl});
      if (source.url !== sourceUrl) throw new Error('播放清晰度已切换，请重新下载。');
    }
  }
}

async function readCurrentSource(tabId, douyin, diagnostic) {
  // Existing tabs can predate extension injection. The helper's document guard
  // keeps this independent entry point from wrapping the site's requests twice.
  if (douyin) {
    markDiagnostic(diagnostic, 'main_injection');
    await chrome.scripting.executeScript({target: {tabId}, world: 'MAIN', files: ['page.js']});
  }
  markDiagnostic(diagnostic, 'current_quality_read');
  return inPage(tabId, async douyin => {
    try {
      return douyin ? await window.__douyinOriginal.getCurrent() : window.__dalanchongDetail.read('current');
    } catch (error) { return {error: error.message}; }
  }, [douyin]);
}

listenMessages(new Set(['DETAIL_DOWNLOAD', 'DETAIL_INFO', 'PARSE_URL']), (message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === 'DETAIL_DOWNLOAD' || message.type === 'DETAIL_INFO') {
    const diagnostic = {requestId: message.requestId, tabId: sender.tab.id,
      type: message.type, quality: message.quality, stage: 'page_check'};
    (async () => {
      if (!['original', 'current'].includes(message.quality)) throw new Error('请选择下载画质。');
      const tab = await chrome.tabs.get(sender.tab.id);
      const page = new URL(tab.url);
      const pageUrl = detailPageURL(page);
      Object.assign(diagnostic, {pageUrl,
        workId: videoPage(page)?.id || page.pathname.match(/^\/short-video\/([^/]+)/)?.[1]});
      if (!pageUrl || pageUrl !== message.pageUrl) throw new Error('页面已切换，请刷新视频信息。');
      const slot = `${tab.id}:${message.quality}`;
      const currentSource = message.quality === 'current' ? await readCurrentSource(tab.id, page.hostname === 'www.douyin.com', diagnostic) : null;
      if (currentSource) diagnostic.currentSource = sourceDiagnostic(currentSource);
      // A blob source and decoded dimensions can stay unchanged across bitrate
      // switches. Include the actual media URL in current-quality cache identity.
      const key = `${sender.documentId}:${message.pageUrl}:${message.quality === 'current' ? `${message.playbackKey}:${currentSource.url}:${JSON.stringify(currentSource.urls || [])}` : ''}`;
      let entry = detailMedia.get(slot);
      diagnostic.cacheHit = entry?.key === key;
      if (entry?.key !== key) {
        // A tab has one page-side original probe; let its previous request finish
        // cleanup before starting a probe for the next work.
        const previous = message.quality === 'original' && entry ? entry.promise.catch(() => {}) : Promise.resolve();
        // Shared work owns its stage data; each waiter copies that data into its
        // own request context so INFO/DOWNLOAD failures keep their own requestId.
        const operation = {};
        Object.defineProperty(operation, 'requests', {value: new Set()});
        entry = {key, diagnostic: operation,
          promise: previous.then(() => prepareDetail(tab, message.quality, message.playbackKey, currentSource, operation))};
        detailMedia.set(slot, entry);
        entry.promise.catch(() => { if (detailMedia.get(slot) === entry) detailMedia.delete(slot); });
      }
      entry.diagnostic.requests.add(diagnostic);
      let record;
      try { record = await entry.promise; }
      finally { Object.assign(diagnostic, entry.diagnostic); }
      const info = {ok: true, size: record.size, sizeVerified: record.sizeVerified};
      if (message.type === 'DETAIL_INFO') return info;
      await requireDetailPage(tab.id, page, message.quality, message.playbackKey, currentSource?.url, diagnostic);
      markDiagnostic(diagnostic, 'download_queue', {size: record.size, sizeVerified: record.sizeVerified});
      const [jobId] = await queueDownloads([record]);
      return {...info, jobId};
    })().then(result => respond({...result, diagnostic}), error => {
      const message = diagnosticText(error.message);
      respond({error: message, diagnostic: {...diagnostic, errorName: error.name,
        message, stack: diagnosticText(error.stack)}});
    });
    return true;
  }
  if (message.type === 'PARSE_URL') {
    const key = `parse:${message.requestId}`;
    let state = {status: 'loading', requestId: message.requestId};
    const progress = async patch => {
      state = {...state, ...patch};
      await chrome.storage.session.set({[key]: state});
    };
    resolveVideoURL(message.value, {onProgress: progress, resolveWork: resolveBatchWork})
      .then(result => progress({status: 'ready', ...result, message: `解析完成，发现 ${result.items.length} 个可下载视频。`}),
        error => progress({status: 'error', message: error.message}));
    respond({ok: true});
    return;
  }
});

chrome.tabs.onRemoved.addListener(tabId => {
  detailMedia.delete(`${tabId}:original`);
  detailMedia.delete(`${tabId}:current`);
});

// Platform addresses expire. When a download fails, resolve the source page again once and queue the same quality.
async function refreshFailedJob(job) {
  const key = `job:${job.id}`;
  const mark = async patch => {
    const current = (await chrome.storage.session.get(key))[key];
    if (current) await chrome.storage.session.set({[key]: {...current, ...patch}});
  };
  await mark({refresh: 'running'});
  try {
    // Automatic refresh must keep the original quality of the queued job.
    const result = await resolveVideoURL(job.sourceUrl, {onProgress: async () => {},
      resolveWork: (id, onProgress) => resolveBatchWork(id, onProgress, false)});
    const [fresh] = result.items;
    const [jobId] = await queueDownloads([{...fresh, refreshedFrom: job.id}]);
    await mark({refresh: 'done', refreshJobId: jobId});
  } catch (error) {
    await mark({refresh: 'failed', refreshError: error.message});
  }
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  for (const [key, {newValue: job}] of Object.entries(changes)) {
    if (key.startsWith('job:') && job?.status === 'error' && job.quality === '原片候选' && !job.refresh && !job.refreshedFrom && videoPage(job.sourceUrl || 'about:blank')) {
      void refreshFailedJob(job);
    }
  }
});

