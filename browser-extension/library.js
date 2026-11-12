/**
 * AI module map
 * Purpose: own verified video records and a six-download Chrome-native queue.
 * Entry: detail parsing and capture import addMedia; popup and manager use library messages.
 * Flow: verified captures and detail parsing save media:<id>; queueDownloads saves job:<id>, then
 * Chrome downloads owns file transfer while the worker records progress and completion.
 * State: media writes and queue passes are serialized independently. Each free download
 * slot prepares its next file independently without blocking later queue passes;
 * preparation reserves that slot until it fails or starts a transfer. Session records
 * restore queued/fetching jobs whenever the worker wakes; existing download IDs are reused.
 * Invariants: only complete verified videos enter the queue. A post-save queue pass
 * catches completion events that raced the download ID write. A one-second progress
 * timer runs only while preparation or transfers occupy slots; terminal events advance the queue.
 * Side effects: session storage, Chrome downloads, a progress timer, and the captured-video icon badge.
 */
import {platformName, normalizeMediaURL, fileName, probeMediaFile} from './media.js';
import {canCaptureSource, mediaIdentity, mediaTabIds, uniqueMedia, videoGroupKey} from './media-records.js';
import {listenMessages} from './messages.js';

let writes = Promise.resolve();
let queueWork = Promise.resolve();
let progressTimer;
const DOWNLOAD_CONCURRENCY = 6;
const preparing = new Set();
const keyFor = id => `media:${id}`;

export function addMedia(item) {
  const write = writes.then(async () => {
    const url = normalizeMediaURL(item.url);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(mediaIdentity(url)));
    const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    const key = keyFor(id);
    const previous = (await chrome.storage.session.get(key))[key];
    // Keep parsed work identity while allowing passive responses/playback to add
    // actual file size, MIME type and dimensions to the same media record.
    const metadata = {...previous, ...item};
    if (item.quality === '网页视频' && previous && previous.quality !== '网页视频') {
      metadata.title = previous.title;
      metadata.quality = previous.quality;
      metadata.sourceUrl = previous.sourceUrl;
    }
    const sourceTabIds = [...new Set([...(previous ? mediaTabIds(previous) : []), ...mediaTabIds(item)])];
    const record = {...metadata, id, url, sourceTabIds, platform: platformName(metadata.sourceUrl),
      createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now()};
    await chrome.storage.session.set({[key]: record});
    return record;
  });
  writes = write.catch(error => {
    console.error('保存视频记录失败', error);
  });
  return write;
}

export async function queueDownloads(items) {
  await writes;
  if (items.some(item => !canCaptureSource(item.sourceUrl) || !item.mediaVerified ||
      item.kind !== 'video' || !/^https?:/.test(item.url)))
    throw new Error('部分地址尚未确认是视频，请重新解析后再下载。');
  const jobs = items.map(item => ({...item, id: crypto.randomUUID(), mediaId: item.id,
    createdAt: Date.now(), received: 0, status: 'queued',
    filename: fileName(item.title, item.quality === '原片候选' ? '原片' : item.quality || '视频', item.contentType)}));
  await chrome.storage.session.set(Object.fromEntries(jobs.map(job => [`job:${job.id}`, job])));
  void scheduleQueue();
  return jobs.map(job => job.id);
}

async function saveJob(job) {
  await chrome.storage.session.set({[`job:${job.id}`]: job});
  return job;
}

async function syncDownload(job) {
  const [download] = await chrome.downloads.search({id: job.downloadId});
  if (!download) return saveJob({...job, status: 'error', error: 'Chrome 下载记录已移除。'});
  const now = Date.now();
  const elapsed = now - (job.progressAt || now);
  const status = download.state === 'complete' ? 'complete' : download.state === 'interrupted'
    ? download.error === 'USER_CANCELED' ? 'canceled' : 'error' : 'fetching';
  return saveJob({...job, status, error: download.error || '', received: download.bytesReceived,
    size: download.totalBytes > 0 ? download.totalBytes : job.size,
    speed: elapsed > 0 ? Math.max(0, download.bytesReceived - job.received) * 1000 / elapsed : 0,
    progressAt: now});
}

async function runQueue() {
  clearTimeout(progressTimer);
  // Snapshot reservations before storage or progress awaits. A preparation may
  // finish during those awaits, but this pass must not restart its queued snapshot.
  const occupied = new Set(preparing);
  const stored = await chrome.storage.session.get(null);
  const jobs = Object.entries(stored).filter(([key, job]) => key.startsWith('job:') &&
    ['queued', 'fetching'].includes(job.status)).map(([, job]) => job).sort((a, b) => a.createdAt - b.createdAt);
  // Existing Chrome transfers remain authoritative after a worker restart.
  const current = await Promise.all(jobs.map(job => job.downloadId === undefined ? job : syncDownload(job)));
  for (const job of current) if (job.downloadId !== undefined && job.status === 'fetching') occupied.add(job.id);
  const queued = current.filter(job => job.downloadId === undefined && !occupied.has(job.id));
  for (const job of queued.slice(0, Math.max(0, DOWNLOAD_CONCURRENCY - occupied.size))) {
    preparing.add(job.id);
    occupied.add(job.id);
    void startDownload(job).catch(error => console.error('启动下载任务失败', error));
  }
  if (occupied.size) progressTimer = setTimeout(() => { void scheduleQueue(); }, 1000);
}

async function startDownload(job) {
  try {
    const media = await probeMediaFile(job.url, {trustedVideo: true});
    if (media.kind !== 'video') throw new Error('下载地址未返回完整视频文件，请重新解析。');
    const downloadId = await chrome.downloads.download({url: media.url, filename: job.filename,
      saveAs: false, conflictAction: 'uniquify'});
    await saveJob({...job, url: media.url, downloadId, status: 'fetching'});
  } catch (error) {
    await saveJob({...job, status: 'error', error: error.message});
  } finally {
    // Saving precedes release. The next pass also checks small files that finished
    // before onChanged could associate their Chrome ID with the saved job.
    preparing.delete(job.id);
    void scheduleQueue();
  }
}

function scheduleQueue() {
  const pass = queueWork.then(runQueue);
  queueWork = pass.catch(error => console.error('更新下载队列失败', error));
  return queueWork;
}

async function readLibrary() {
  await writes;
  const stored = await chrome.storage.session.get(null);
  const records = Object.entries(stored).filter(([key, item]) => key.startsWith('media:') &&
    canCaptureSource(item.sourceUrl) && item.kind === 'video' && item.mediaVerified).map(([, item]) => item);
  return {schemaVersion: 2, items: uniqueMedia(records),
    jobs: Object.entries(stored).filter(([key]) => key.startsWith('job:')).map(([, job]) => job)};
}

async function handle(message) {
  if (message.type === 'LIST_LIBRARY') return readLibrary();
  if (message.type === 'QUEUE_DOWNLOADS') {
    const keys = message.ids.map(keyFor);
    const stored = await chrome.storage.session.get(keys);
    const items = keys.map(key => stored[key]);
    if (items.some(item => !item)) throw new Error('部分视频记录已清除，请刷新列表后重新选择。');
    return {jobIds: await queueDownloads(items)};
  }
  if (message.type === 'CLEAR_MEDIA') {
    const clear = writes.then(async () => {
      const keys = message.ids.map(keyFor);
      if (message.tabId === undefined) return chrome.storage.session.remove(keys);
      const stored = await chrome.storage.session.get(keys);
      const updates = {}, removed = [];
      for (const [key, item] of Object.entries(stored)) {
        const tabs = mediaTabIds(item);
        if (!tabs.includes(message.tabId)) continue;
        const sourceTabIds = tabs.filter(id => id !== message.tabId);
        if (!sourceTabIds.length) removed.push(key);
        else updates[key] = {...item, sourceTabIds,
          sourceTabId: sourceTabIds.includes(item.sourceTabId) ? item.sourceTabId : sourceTabIds.at(-1)};
      }
      if (Object.keys(updates).length) await chrome.storage.session.set(updates);
      if (removed.length) await chrome.storage.session.remove(removed);
    });
    writes = clear.catch(error => console.error('清空视频记录失败', error));
    await clear;
    return {ok: true};
  }
}

const types = new Set(['LIST_LIBRARY', 'QUEUE_DOWNLOADS', 'CLEAR_MEDIA']);
listenMessages(types, (message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !types.has(message.type)) return;
  if (message.type === 'CLEAR_MEDIA' && sender.tab && !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  handle(message).then(respond, error => respond({error: error.message}));
  return true;
});
chrome.downloads.onChanged.addListener(delta => {
  if (delta.state && ['complete', 'interrupted'].includes(delta.state.current)) void scheduleQueue();
});
void scheduleQueue();

async function updateBadge() {
  const {items} = await readLibrary();
  const count = new Set(items.map(videoGroupKey)).size;
  await chrome.action.setBadgeText({text: count ? (count > 999 ? '999+' : String(count)) : ''});
}
chrome.action.setBadgeBackgroundColor({color: '#171717'});
chrome.action.setBadgeTextColor({color: '#ffffff'});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && Object.keys(changes).some(key => key.startsWith('media:'))) {
    void updateBadge().catch(error => console.error('更新视频数量失败', error));
  }
});
void updateBadge().catch(error => console.error('更新视频数量失败', error));
