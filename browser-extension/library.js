/**
 * AI module map
 * Purpose: service-worker owner of the Douyin media library, download records, and offscreen dispatch.
 * Entry: imported by background.js; exports addMedia, ensureOffscreen, and queueDownloads and handles capture/library/job runtime messages.
 * Flow: page captures and webRequest headers become media:<id> session records; media identity is hashed, formats are grouped, and queued jobs become job:<id> records.
 * State: promise chains serialize media and job writes; one offscreen document runs the queue while Chrome download events finalize saved files.
 * Library readers share an in-flight read/normalization on the media write chain; stale size probes cannot overwrite newer captures.
 * LIST_LIBRARY includes schemaVersion 1 so freshly opened UI can detect a worker
 * still running the earlier source snapshot before consuming its pending-source data.
 * Passive capture skips identical media writes; explicit analysis retains the target work identity supplied by page.js.
 * Invariants: cleared records stay cleared despite late probes/progress; split video requires a same-source audio record; automatic ordinary HTTP video uses the browser engine.
 * Side effects: storage, metadata probes, Chrome downloads, badge updates, and offscreen lifecycle messages.
 */
import {platformName, normalizeMediaURL, mediaType, fileName, probeMediaFile} from './media.js';
import {canCaptureSource, mediaIdentity, mediaSize, uniqueMedia, videoGroupKey} from './media-records.js';
import {isMediaURL, videoPage} from './platforms.js';

let writes = Promise.resolve();
let reading;
let creating;
let jobWrites = Promise.resolve();
const keyFor = id => `media:${id}`;
function patchJob(id, patch) {
  const write = jobWrites.then(async () => {
    const key = `job:${id}`;
    const job = (await chrome.storage.session.get(key))[key];
    // A cleared job stays cleared; late progress reports must not bring it back.
    if (job) await chrome.storage.session.set({[key]: {...job, ...patch}});
  });
  jobWrites = write.catch(console.error);
  return write;
}

export function addMedia(item, {deduplicate = false} = {}) {
  const write = writes.then(async () => {
    const url = normalizeMediaURL(item.url);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mediaIdentity(url)));
    const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = keyFor(id);
    const previous = (await chrome.storage.session.get(key))[key];
    const sourceUrl = item.sourceUrl || previous?.sourceUrl;
    const record = {id, ...previous, ...item, url, sourceUrl,
      createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now()};
    if (previous && item.quality === '网页视频') {
      if (previous.quality && previous.quality !== '网页视频') {
        for (const field of ['quality', 'title', 'author', 'videoOnly', 'height', 'bitrate', 'awemeId', 'videoId', 'sourceUrl']) if (previous[field] !== undefined) record[field] = previous[field];
      }
      if (!item.contentType && previous.contentType) { record.contentType = previous.contentType; record.kind = previous.kind; }
      if (previous.sizeVerified && !item.sizeVerified) { record.size = previous.size; record.sizeVerified = true; record.sizeCheckedAt = previous.sizeCheckedAt; }
    }
    if (previous?.url === url && previous.mediaVerified && !item.mediaVerified) {
      record.mediaVerified = true; record.mediaCheckedAt = previous.mediaCheckedAt;
      record.kind = previous.kind; record.contentType = previous.contentType;
    }
    if (previous?.url !== url && !item.mediaVerified) {
      record.mediaVerified = false; delete record.mediaCheckedAt;
    }
    if (previous && !record.sizeVerified && (previous.url !== url || (item.quality && item.quality !== '网页视频'))) delete record.sizeCheckedAt;
    if (record.kind === 'hls') { record.size = 0; record.sizeVerified = false; }
    record.platform = platformName(record.sourceUrl);
    // Passive range/player repeats do not refresh every list. Explicit analysis still
    // refreshes the verified detail-derived record for this work.
    if (deduplicate && previous && Object.keys(record).every(field => ['updatedAt', 'sizeCheckedAt', 'mediaCheckedAt'].includes(field) || record[field] === previous[field])) return previous;
    await chrome.storage.session.set({[key]: record});
    return record;
  });
  writes = write.catch(error => console.error('保存视频记录失败', error));
  return write;
}

export async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
  if (contexts.length) return;
  if (!creating) {
    creating = chrome.offscreen.createDocument({url: 'offscreen.html', reasons: ['BLOBS', 'WORKERS'],
      justification: '并行下载视频分段，在本地合并音视频并生成下载文件。'}).finally(() => { creating = null; });
  }
  await creating;
}

export async function queueDownloads(items) {
  await writes;
  if (items.some(item => !canCaptureSource(item.sourceUrl) || !item.mediaVerified ||
      !['video', 'hls'].includes(item.kind) || !/^https?:/.test(item.url)))
    throw new Error('部分地址尚未确认是视频，请重新解析或播放后再下载。');
  const stored = items.some(item => item.videoOnly) ? await chrome.storage.session.get(null) : {};
  const audioBySource = new Map();
  for (const [key, item] of Object.entries(stored)) {
    if (!key.startsWith('media:') || item.kind !== 'audio') continue;
    const previous = audioBySource.get(item.sourceUrl);
    if (!previous || (item.bitrate || 0) > (previous.bitrate || 0) ||
        ((item.bitrate || 0) === (previous.bitrate || 0) && item.updatedAt > previous.updatedAt)) audioBySource.set(item.sourceUrl, item);
  }
  const jobs = items.map(item => {
    const track = item.videoOnly ? audioBySource.get(item.sourceUrl) : null;
    if (item.videoOnly && !track) throw new Error('此视频的音轨尚未识别，请先在作品页播放视频，再重试下载。');
    return {...item, id: crypto.randomUUID(), mediaId: item.id, threads: 8,
      engine: !track && item.kind === 'video' ? 'browser' : 'parallel',
      audioUrl: track?.url, createdAt: Date.now(), received: 0, status: 'queued',
      filename: fileName(item.title, item.quality === '原片候选' ? '原片' : item.quality || '视频', item.kind === 'hls' || track ? 'video/mp4' : item.contentType)};
  });
  await ensureOffscreen();
  await chrome.storage.session.set(Object.fromEntries(jobs.map(job => [`job:${job.id}`, job])));
  await chrome.runtime.sendMessage({target: 'offscreen', type: 'ENQUEUE', jobs});
  return jobs.map(job => job.id);
}

chrome.webRequest.onResponseStarted.addListener(details => {
  if (details.tabId < 0 || details.statusCode >= 400 || details.initiator?.startsWith('chrome-extension:')) return;
  const header = name => details.responseHeaders.find(item => item.name.toLowerCase() === name)?.value || '';
  const contentType = header('content-type');
  const kind = mediaType(details.url, contentType);
  if (!kind || kind === 'audio') return;
  const size = mediaSize(details.statusCode, header, kind);
  const mediaVerified = kind === 'video' && /^video\//i.test(contentType);
  chrome.tabs.get(details.tabId).then(tab => {
    // Public work pages are identified by their detail API, not every stream
    // loaded by recommendations or embedded players in the same tab.
    if (!canCaptureSource(tab.url) || videoPage(tab.url)) return;
    return addMedia({url: details.url, title: tab.title || '网页视频',
      sourceUrl: tab.url, sourceTabId: details.tabId, frameId: details.frameId, contentType, kind,
      mediaVerified, ...(mediaVerified ? {mediaCheckedAt: Date.now()} : {}),
      size, sizeVerified: size > 0, sizeCheckedAt: size > 0 ? Date.now() : undefined,
      quality: '网页视频'}, {deduplicate: true});
  }).catch(error => console.error('记录视频请求失败', error));
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);

const inspectionQueue = [];
const inspecting = new Set();
let inspectionCount = 0;
function patchMedia(item, patch) {
  const write = writes.then(async () => {
    const key = keyFor(item.id);
    const record = (await chrome.storage.session.get(key))[key];
    // Ignore probes for cleared/replaced URLs and preserve a newer verified network size.
    if (record && record.url === item.url && (!record.mediaVerified || !record.sizeVerified)) await chrome.storage.session.set({[key]: {...record, ...patch}});
  });
  writes = write.catch(console.error);
  return write;
}
function inspectUnknownSizes(items) {
  for (const item of items) if (['video', 'hls'].includes(item.kind) && /^https?:/.test(item.url) &&
      ((!item.mediaVerified && !item.mediaCheckedAt) || (item.kind === 'video' && !item.sizeVerified && !item.sizeCheckedAt)) && !inspecting.has(item.id)) {
    inspecting.add(item.id); inspectionQueue.push(item);
  }
  const pump = () => {
    while (inspectionCount < 3 && inspectionQueue.length) {
      const item = inspectionQueue.shift(); inspectionCount++;
      probeMediaFile(item.url, {trustedVideo: Boolean(item.awemeId && videoPage(item.sourceUrl))}).then(patch => patchMedia(item, patch),
        () => patchMedia(item, {mediaVerified: false, mediaCheckedAt: Date.now(), size: 0, sizeVerified: false, sizeCheckedAt: Date.now()}))
        .finally(() => {inspectionCount--; inspecting.delete(item.id); pump();});
    }
  };
  pump();
}
function readLibrary() {
  if (reading) return reading;
  const read = writes.then(readLibrarySnapshot);
  writes = read.then(() => {}, console.error);
  reading = read.finally(() => { reading = undefined; });
  return reading;
}
async function readLibrarySnapshot() {
  const stored = await chrome.storage.session.get(null);
  const records = [], updates = {};
  for (const [key, record] of Object.entries(stored)) {
    if (!key.startsWith('media:')) continue;
    let sourceUrl = record.sourceUrl;
    if (!canCaptureSource(sourceUrl)) {
      if (/^\d+$/.test(record.awemeId || '') && isMediaURL(record.url)) sourceUrl = `https://www.douyin.com/video/${record.awemeId}`;
      else continue;
    }
    if (!/^https?:/.test(record.url) || (record.contentType && !mediaType(record.url, record.contentType) && !/^(application|binary)\/octet-stream(?:;|$)/i.test(record.contentType))) continue;
    if (videoPage(sourceUrl) && !record.awemeId) continue;
    const item = {...record, sourceUrl, platform: platformName(sourceUrl)};
    if (item.kind === 'hls' || !item.sizeVerified) {item.size = 0; item.sizeVerified = false;}
    records.push(item);
  }
  const unique = uniqueMedia(records);
  for (const item of unique) {
    const previous = stored[keyFor(item.id)];
    // Normalization/merging preserves nested metadata references from the preferred
    // stored record; compare fields without serializing the full library twice.
    if (!previous || Object.keys(item).some(key => item[key] !== previous[key])) updates[keyFor(item.id)] = item;
  }
  if (Object.keys(updates).length) await chrome.storage.session.set(updates);
  inspectUnknownSizes(unique);
  const items = unique.filter(item => ['video', 'hls'].includes(item.kind) && item.mediaVerified);
  const pendingSources = unique.filter(item => ['video', 'hls'].includes(item.kind) && !item.mediaVerified && !item.mediaCheckedAt)
    .map(({sourceTabId, sourceUrl}) => ({sourceTabId, sourceUrl}));
  return {schemaVersion: 1, items, pendingCount: pendingSources.length, pendingSources,
    jobs: Object.entries(stored).filter(([key]) => key.startsWith('job:')).map(([, job]) => job)};
}


async function handle(message, sender) {
  if (message.type === 'CAPTURE_MEDIA') {
    const item = message.item;
    if (!/^https?:/.test(item.url) || !sender.tab || !canCaptureSource(sender.tab.url) || videoPage(sender.tab.url)) return;
    const kind = mediaType(item.url, item.contentType || '');
    if (!kind || kind === 'audio') return;
    return addMedia({...item, sourceUrl: sender.tab.url, sourceTabId: sender.tab.id, frameId: sender.frameId,
      kind, mediaVerified: false, quality: '网页视频'},
      {deduplicate: message.refresh !== true});
  }
  if (message.type === 'LIST_LIBRARY') return readLibrary();
  if (message.type === 'QUEUE_DOWNLOADS') {
    const keys = message.ids.map(keyFor);
    const stored = await chrome.storage.session.get(keys);
    const items = keys.map(key => stored[key]);
    if (items.some(item => !item)) throw new Error('部分视频记录已清除，请刷新列表后重新选择。');
    return {jobIds: await queueDownloads(items)};
  }
  if (message.type === 'CLEAR_LIBRARY') {
    const clear = writes.then(async () => {
      // Clearing the list also drops probes that have not started downloading metadata.
      for (const item of inspectionQueue) inspecting.delete(item.id);
      inspectionQueue.length = 0;
      const stored = await chrome.storage.session.get(null);
      await chrome.storage.session.remove(Object.keys(stored).filter(key => key.startsWith('media:')));
    });
    writes = clear.catch(console.error);
    await clear;
    return {ok: true};
  }
  if (message.type === 'JOB_UPDATE') {
    await patchJob(message.id, message.patch);
    return {ok: true};
  }
  if (message.type === 'START_NATIVE') {
    const job = (await chrome.storage.session.get(`job:${message.id}`))[`job:${message.id}`];
    const media = await probeMediaFile(job.url, {trustedVideo: job.mediaVerified});
    if (media.kind !== 'video') throw new Error('下载地址未返回视频文件，请重新解析。');
    const downloadId = await chrome.downloads.download({url: media.url, filename: job.filename, saveAs: false, conflictAction: 'uniquify'});
    await patchJob(job.id, {downloadId, status: 'fetching'});
    await finishDownload(downloadId);
    return {downloadId};
  }
  if (message.type === 'SYNC_NATIVE') {
    const job = (await chrome.storage.session.get(`job:${message.id}`))[`job:${message.id}`];
    const [download] = await chrome.downloads.search({id: job.downloadId});
    if (!download) throw new Error('Chrome 下载记录已移除。');
    const now = Date.now();
    const speed = job.progressAt ? Math.max(0, download.bytesReceived - job.received) * 1000 / (now - job.progressAt) : 0;
    await patchJob(job.id, {received: download.bytesReceived, size: download.totalBytes > 0 ? download.totalBytes : job.size, speed, progressAt: now});
    await finishDownload(job.downloadId, download);
    return {ok: true};
  }
  if (message.type === 'SAVE_BLOB') {
    const key = `job:${message.id}`;
    const job = (await chrome.storage.session.get(key))[key];
    const downloadId = await chrome.downloads.download({url: message.url, filename: job.filename, saveAs: false, conflictAction: 'uniquify'});
    await patchJob(message.id, {status: 'saving', downloadId});
    await finishDownload(downloadId);
    return {downloadId};
  }
  if (message.type === 'CLEAR_JOBS') {
    await jobWrites;
    const stored = await chrome.storage.session.get(null);
    // Only downloads the offscreen document is still working on are kept; stalled ones are cleared too.
    const [offscreen] = await chrome.runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
    const live = new Set(offscreen ? (await chrome.runtime.sendMessage({target: 'offscreen', type: 'LIVE_IDS'}))?.ids : []);
    const removed = Object.keys(stored).filter(key => key.startsWith('job:') && !live.has(key.slice(4)));
    await chrome.storage.session.remove(removed);
    return {ok: true, removed: removed.length, kept: live.size};
  }
  if (message.type === 'CANCEL_JOB') {
    const job = (await chrome.storage.session.get(`job:${message.id}`))[`job:${message.id}`];
    if (job.downloadId) await chrome.downloads.cancel(job.downloadId);
    else await chrome.runtime.sendMessage({target: 'offscreen', type: 'CANCEL', id: job.id});
    return {ok: true};
  }
}

const types = new Set(['CAPTURE_MEDIA', 'LIST_LIBRARY', 'QUEUE_DOWNLOADS', 'CLEAR_LIBRARY', 'CLEAR_JOBS', 'JOB_UPDATE', 'SAVE_BLOB', 'CANCEL_JOB', 'START_NATIVE', 'SYNC_NATIVE']);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target === 'offscreen' || !types.has(message.type)) return;
  handle(message, sender).then(respond, error => respond({error: error.message}));
  return true;
});
async function finishDownload(downloadId, download) {
  if (!download) [download] = await chrome.downloads.search({id: downloadId});
  if (!download || !['complete', 'interrupted'].includes(download.state)) return;
  const stored = await chrome.storage.session.get(null);
  const entry = Object.entries(stored).find(([key, job]) => key.startsWith('job:') && job.downloadId === downloadId);
  if (!entry) return;
  const [key, job] = entry;
  const status = download.state === 'complete' ? 'complete' : download.error === 'USER_CANCELED' ? 'canceled' : 'error';
  await patchJob(job.id, {status, error: download.error});
  await chrome.runtime.sendMessage({target: 'offscreen', type: 'RELEASE', id: job.id});
}
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) void finishDownload(delta.id).catch(console.error);
});

// The toolbar badge shows how many videos have been captured so far (one per work, audio tracks excluded).
let badgeTimer;
async function updateBadge() {
  const stored = await chrome.storage.session.get(null);
  const records = Object.entries(stored).filter(([key, item]) => key.startsWith('media:') && item.mediaVerified && ['video', 'hls'].includes(item.kind) && canCaptureSource(item.sourceUrl || '')).map(([, item]) => item);
  const count = new Set(uniqueMedia(records).map(videoGroupKey)).size;
  await chrome.action.setBadgeText({text: count ? (count > 999 ? '999+' : String(count)) : ''});
}
chrome.action.setBadgeBackgroundColor({color: '#0f172a'});
chrome.action.setBadgeTextColor?.({color: '#ffffff'});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !Object.keys(changes).some(key => key.startsWith('media:'))) return;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => void updateBadge().catch(console.error), 300);
});
void updateBadge().catch(console.error);
