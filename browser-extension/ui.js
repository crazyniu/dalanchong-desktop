/**
 * AI module map
 * Purpose: shared DOM, media-format, progress, and interaction helpers for the popup and manager.
 * Entry: named exports are consumed by popup.js, manager.js, and player.js.
 * Flow: media-record grouping and background runtime replies feed labels, rows, controls, queue actions, and toasts.
 * State: resolution metadata uses a local cache plus res:<id> session entries; at most two hidden video probes run concurrently and release their sources when done or removed from the displayed formats.
 * Boundary: media/jobs remain background-owned; send propagates runtime errors rather than treating them as successful results.
 * readLibrary requires the current snapshot schema; a stale worker offers explicit
 * extension reload instead of assigning missing fields to live UI state.
 * Side effects: DOM construction, clipboard writes, metadata probes, extension storage, and runtime messages.
 */
// Shared helpers for popup.html and manager.html.
import {videoGroups} from './media-records.js';

export const $ = id => document.getElementById(id);
export const jobStates = {queued: '排队中', fetching: '下载中', merging: '合并音视频', saving: '正在保存', complete: '已完成', error: '失败', canceled: '已取消'};
export const activeStates = ['queued', 'fetching', 'merging', 'saving'];

export const sizeText = bytes => !bytes ? '大小未知' : bytes >= 1000 ** 3 ? `${(bytes / 1000 ** 3).toFixed(2)} GB` : bytes >= 1000 ** 2 ? `${(bytes / 1000 ** 2).toFixed(1)} MB` : bytes >= 1000 ? `${(bytes / 1000).toFixed(1)} KB` : `${bytes} B`;
export const jobFraction = job => ['complete', 'saving'].includes(job.status) ? 1 : job.fraction || (job.size ? job.received / job.size : 0);

export async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}

export async function readLibrary() {
  const snapshot = await send({type: 'LIST_LIBRARY'});
  if (snapshot?.schemaVersion !== 1) {
    const error = new Error('插件已更新，需要重新加载');
    error.code = 'EXTENSION_RELOAD_REQUIRED';
    throw error;
  }
  return snapshot;
}

export function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function icon(name, slot) {
  const node = element('wa-icon');
  node.name = name;
  if (slot) node.slot = slot;
  return node;
}

export function iconButton(name, label, className = 'btn icon') {
  const node = element('button', undefined, className);
  node.type = 'button'; node.title = label;
  node.setAttribute('aria-label', label);
  node.append(icon(name));
  return node;
}

// Resolution comes from the platform when it reports one; otherwise it is read from the file's metadata.
const resolutions = new Map();
const probing = new Set();
const activeProbes = new Map();
const heightOf = format => format.height || resolutions.get(format.id) || 0;
const labelKind = {'原片候选': '原片', '高清 MP4': '高清', 'HLS': 'HLS'};
export function qualityText(format) {
  const height = heightOf(format);
  const kind = labelKind[format.quality] || '';
  if (height) return kind ? `${height}P ${kind}` : `${height}P`;
  if (kind) return kind;
  return format.kind === 'audio' ? '音轨' : '';
}
export const formatText = format => [qualityText(format), sizeText(format.size)].filter(Boolean).join(' · ');

export async function loadResolutions() {
  const stored = await chrome.storage.session.get(null);
  for (const [key, value] of Object.entries(stored)) if (key.startsWith('res:')) resolutions.set(key.slice(4), value);
}

let probeQueue = [], probeRunning = 0, probeListener;
export function probeResolutions(formats, onChange) {
  probeListener = onChange;
  const requested = new Set(formats.map(format => format.id));
  // Filtering or clearing the list must stop metadata downloads for hidden rows.
  probeQueue = probeQueue.filter(format => {
    if (requested.has(format.id)) return true;
    probing.delete(format.id);
    return false;
  });
  for (const [id, cancel] of activeProbes) if (!requested.has(id)) cancel();
  for (const format of formats) {
    if (heightOf(format) || resolutions.has(format.id) || probing.has(format.id) || format.kind !== 'video') continue;
    probing.add(format.id);
    probeQueue.push(format);
  }
  pumpProbes();
}
function pumpProbes() {
  while (probeRunning < 2 && probeQueue.length) {
    const format = probeQueue.shift();
    probeRunning++;
    const video = document.createElement('video');
    video.muted = true; video.preload = 'metadata';
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onMetadata);
      video.removeEventListener('error', onError);
      video.removeAttribute('src'); video.load();
      probing.delete(format.id);
      activeProbes.delete(format.id);
      probeRunning--;
    };
    const done = height => {
      cleanup();
      resolutions.set(format.id, height);
      void chrome.storage.session.set({[`res:${format.id}`]: height});
      probeListener?.();
      pumpProbes();
    };
    const onMetadata = () => done(Math.min(video.videoWidth, video.videoHeight) || Math.max(video.videoWidth, video.videoHeight));
    const onError = () => done(0);
    const timer = setTimeout(() => done(0), 12000);
    video.addEventListener('loadedmetadata', onMetadata, {once: true});
    video.addEventListener('error', onError, {once: true});
    activeProbes.set(format.id, cleanup);
    video.src = format.url;
  }
}

export function thumb(item) {
  const node = element('div', undefined, 'thumb');
  node.dataset.platform = item.platform;
  node.append(icon('video'));
  return node;
}

// One row per work, best resolution first; the chosen quality decides which record the row stands for.
export function groupedItems(items, chosen) {
  return videoGroups(items).map(group => {
    // Streams captured from the page's own player add nothing once formats with a known quality exist.
    const known = group.formats.filter(format => qualityText(format));
    const formats = (known.length ? known : group.formats).toSorted((a, b) => heightOf(b) - heightOf(a) || (b.size || 0) - (a.size || 0));
    return {...(formats.find(item => item.id === chosen.get(group.key)) || formats[0]), groupKey: group.key, formats};
  });
}

export function qualitySelect(item, onChange, className = 'quality-select') {
  const select = element('wa-select', undefined, `${className} label-hidden`);
  select.size = 's'; select.label = `选择 ${item.title} 的画质`; select.value = item.id;
  for (const format of item.formats) {
    const option = element('wa-option', formatText(format));
    option.value = format.id;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value));
  return select;
}

export function indexDownloadJobs(jobs) {
  const latest = new Map();
  for (const job of jobs) {
    const previous = latest.get(job.mediaId);
    if (!previous || job.createdAt > previous.createdAt) latest.set(job.mediaId, job);
  }
  return latest;
}

// The selected quality owns its job status, matching preview/copy/download identity.
export function downloadState(item, jobsByMedia, onDownload) {
  const job = jobsByMedia.get(item.id);
  if (job && activeStates.includes(job.status)) {
    const fraction = jobFraction(job);
    const node = element('div', undefined, 'item-progress');
    const ring = element('div', undefined, fraction ? 'ring' : 'ring indeterminate');
    ring.style.setProperty('--p', String(Math.round(fraction * 100)));
    node.title = fraction ? `${jobStates[job.status]} ${Math.round(fraction * 100)}%` : jobStates[job.status];
    node.setAttribute('role', 'status');
    node.setAttribute('aria-label', node.title);
    ring.setAttribute('aria-hidden', 'true');
    node.append(ring, element('span', jobStates[job.status]));
    return node;
  }
  if (job?.status === 'complete' && job.mediaId === item.id) {
    const node = element('div', undefined, 'item-done');
    node.title = '已下载';
    node.setAttribute('role', 'status');
    node.append(icon('circle-check'), element('span', '已下载'));
    return node;
  }
  const retry = job && ['error', 'canceled'].includes(job.status);
  const download = iconButton(retry ? 'refresh-cw' : 'download', retry ? '重新下载' : '下载', 'btn primary dl');
  download.onclick = async () => {
    download.disabled = true;
    try { await onDownload(); }
    catch (error) { toast(error.message, true); download.disabled = false; }
  };
  if (!retry) return download;
  const result = element('div', undefined, 'download-result');
  result.dataset.status = job.status;
  result.title = job.error || jobStates[job.status];
  result.append(download, element('span', job.status === 'error' ? '下载失败' : '已取消'));
  return result;
}

export async function queue(ids) {
  return send({type: 'QUEUE_DOWNLOADS', ids, threads: 8, mode: 'auto'});
}

export function showLibraryError(error, retry) {
  const status = $('library-status');
  status.hidden = false;
  $('empty').hidden = true;
  if (error.code === 'EXTENSION_RELOAD_REQUIRED') {
    const reload = element('button', '重新加载插件', 'btn primary');
    reload.type = 'button';
    reload.onclick = () => chrome.runtime.reload();
    status.replaceChildren(element('span', error.message), reload);
    toast('');
    return;
  }
  const button = element('button', '重试', 'btn outline');
  button.type = 'button';
  button.onclick = () => {
    status.replaceChildren(element('wa-spinner'), element('span', '正在加载视频…'));
    void retry().catch(reason => showLibraryError(reason, retry));
  };
  status.replaceChildren(element('span', '视频读取失败'), button);
  toast(error.message, true);
}

let toastTimer;
export function toast(text, error = false) {
  let node = document.querySelector('.toast');
  clearTimeout(toastTimer);
  if (!text) { node?.remove(); return; }
  if (!node) {
    node = element('div', undefined, 'toast');
    node.setAttribute('role', 'status');
    node.setAttribute('aria-live', 'polite');
    document.body.append(node);
  }
  node.classList.remove('leaving');
  node.dataset.error = String(error);
  node.replaceChildren(icon(error ? 'circle-alert' : 'circle-check'), element('span', text));
  toastTimer = setTimeout(() => {
    node.classList.add('leaving');
    toastTimer = setTimeout(() => node.remove(), 200);
  }, error ? 6000 : 2600);
}

export async function copyText(text, message = '已复制视频地址') {
  try { await navigator.clipboard.writeText(text); toast(message); }
  catch (error) { toast(error.message, true); }
}

