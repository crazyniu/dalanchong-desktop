/**
 * AI module map
 * Purpose: captured-video batch downloads and Douyin original-first link parsing.
 * Entry: manager.html loads from the popup's captured scope or the shop bookmark.
 * Flow: compact share-link input calls background PARSE_URL; collapsible parse records
 * accompany the main video list, and its fixed batch bar copies or queues selected formats.
 * State: parsed group keys persist in page sessionStorage; selection uses those same
 * work keys while format choices remain local. chrome.storage.session supplies validated
 * media/jobs. Parse jobs are keyed by normalized share link.
 * Each media render computes grouping once; selection-only changes reuse rendered rows.
 * List links display the selected format's playback URL and open it in a new tab.
 * Invariants: this page lists its captured scope and works parsed here; serialized parsing prefers original quality,
 * then accepts the available quality returned by the background. Only user actions select rows.
 * Side effects: runtime messages, storage listeners, clipboard writes, parser timers, DOM updates, and player.js previews.
 */
import './vendor/ui/components.js';
import {createPlayer} from './player.js';
import {mediaTabIds, videoGroups, videoGroupKey} from './media-records.js';
import {videoPage} from './platforms.js';
import {extractVideoURLs} from './resolve.js';
import {$, activeStates, copyText, downloadState, element, groupedItems, icon, iconButton, indexDownloadJobs, loadResolutions, probeResolutions, qualitySelect, qualityText, queue, readLibrary, send, showLibraryError, sizeText, thumb, toast} from './ui.js';

const selected = new Set();
const chosenFormats = new Map();
const renderedMedia = new Map();
let jobsByMedia = new Map(), parsedMediaIds = new Set();
let items = [], jobs = [], inputTimer;
let parsed = [], visible = [], submitting = false;
const pageURL = new URL(location.href);
const capturedView = pageURL.searchParams.get('view') === 'captured';
const capturedTabId = pageURL.searchParams.has('tabId') ? Number(pageURL.searchParams.get('tabId')) : null;
const capturedIds = new Set((pageURL.searchParams.get('ids') || '').split(',').filter(Boolean));
let initialSelection = capturedIds.size > 0;
if (capturedView) {
  $('videos-title').textContent = '视频批量下载';
  document.title = '视频批量下载 · 大懒虫';
}
// Parsed works remain part of this page when additional links are submitted.
const parsedKeys = new Set(JSON.parse(sessionStorage.getItem('parsedKeys') || '[]'));
const saveParsed = () => sessionStorage.setItem('parsedKeys', JSON.stringify([...parsedKeys]));

function inCapturedScope(item) {
  if (!capturedView) return false;
  if (capturedIds.size && !capturedIds.has(item.id)) return false;
  return capturedTabId === null || mediaTabIds(item).includes(capturedTabId);
}

/* ---------- Videos ---------- */
function renderSelection(updateRows = false) {
  const checked = visible.filter(item => selected.has(item.groupKey)).length;
  $('select-all').checked = visible.length > 0 && checked === visible.length;
  $('select-all').indeterminate = checked > 0 && checked < visible.length;
  $('select-all').disabled = visible.length === 0;
  $('batch-bar').hidden = parsed.length === 0 && !submitting;
  $('batch-summary').textContent = selected.size ? `已选 ${selected.size} 个视频` : `${parsed.length} 个视频`;
  $('batch-clear').hidden = selected.size === 0;
  $('batch-copy').disabled = selected.size === 0;
  $('batch-download').hidden = selected.size === 0;
  $('batch-download').disabled = submitting;
  $('download-all').disabled = submitting || parsed.length === 0;
  $('download-all').classList.toggle('primary', selected.size === 0);
  $('download-all').classList.toggle('outline', selected.size > 0);
  if (updateRows) for (const {item, row, checkbox} of renderedMedia.values()) {
    checkbox.checked = selected.has(item.groupKey);
    row.dataset.selected = String(checkbox.checked);
  }
}

function mediaRow(item) {
  const row = element('article', undefined, item.formats.length > 1 ? 'media-row has-formats' : 'media-row');
  row.dataset.id = item.id;
  row.dataset.selected = String(selected.has(item.groupKey));

  const checkbox = element('wa-checkbox');
  checkbox.checked = selected.has(item.groupKey);
  checkbox.append(element('span', `选择 ${item.title}`, 'sr-only'));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.add(item.groupKey); else selected.delete(item.groupKey);
    row.dataset.selected = String(checkbox.checked);
    renderSelection();
  });

  const main = element('div', undefined, 'media-main');
  const text = element('div', undefined, 'media-text');
  const title = element('div', item.title || '网页视频', 'media-title ellipsis');
  title.title = item.title || '';
  const meta = element('div', undefined, 'media-meta');
  if (item.author) meta.append(element('span', item.author, 'ellipsis'));
  const source = element('a', item.url, 'source ellipsis');
  source.href = item.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.title = item.url;
  meta.append(source);
  text.append(title, meta);
  main.append(thumb(item), text);

  const quality = element('div', undefined, 'media-quality');
  if (item.formats.length > 1) {
    quality.append(qualitySelect(item, id => {
      chosenFormats.set(item.groupKey, id);
      renderMedia();
    }));
  } else quality.textContent = qualityText(item);

  const size = element('div', item.formats.length > 1 ? '' : sizeText(item.size), item.size ? 'media-size' : 'media-size unknown');
  if (item.size) size.title = `${item.size.toLocaleString('zh-CN')} 字节`;

  const actions = element('div', undefined, 'media-actions');
  const preview = iconButton('eye', '预览');
  preview.onclick = () => openPreview(item);
  const copy = iconButton('copy', '复制视频地址');
  copy.onclick = () => void copyText(item.url);
  const progress = downloadState(item, jobsByMedia, () => start([item.id]));
  renderedMedia.set(item.id, {item, progress, row, checkbox});
  actions.append(preview, copy, progress);

  row.append(checkbox, main, quality, size, actions);
  return row;
}

function renderMedia() {
  const scopedItems = items.filter(item => inCapturedScope(item) || parsedKeys.has(videoGroupKey(item)));
  if (initialSelection) {
    for (const item of scopedItems) {
      if (capturedIds.has(item.id)) {
        const key = videoGroupKey(item);
        selected.add(key); chosenFormats.set(key, item.id);
      }
    }
    initialSelection = false;
  }
  parsed = groupedItems(scopedItems, chosenFormats);
  const currentKeys = new Set(parsed.map(item => item.groupKey));
  for (const key of selected) if (!currentKeys.has(key)) selected.delete(key);
  visible = parsed;
  const total = parsed.length;
  probeResolutions(visible.flatMap(item => item.formats), renderMedia);
  $('visible-count').textContent = String(total);
  $('table-head').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  $('clear').disabled = total === 0;
  parsedMediaIds = new Set(parsed.flatMap(item => item.formats.map(format => format.id)));
  renderJobSummary();
  renderedMedia.clear();
  $('media-list').replaceChildren(...visible.map(mediaRow));
  renderSelection();
}

function renderJobSummary() {
  const active = jobs.filter(job => activeStates.includes(job.status) && parsedMediaIds.has(job.mediaId)).length;
  $('job-summary').textContent = active ? `${active} 个视频下载中` : '';
}

function renderDownloadProgress(changedIds) {
  // Keep selection, quality controls and row DOM intact while download bytes change.
  for (const row of renderedMedia.values()) {
    if (!row.item.formats.some(format => changedIds.has(format.id))) continue;
    const progress = downloadState(row.item, jobsByMedia, () => start([row.item.id]));
    row.progress.replaceWith(progress);
    row.progress = progress;
  }
  renderJobSummary();
}

async function start(ids) {
  const {jobIds} = await queue(ids);
  toast(`已添加 ${jobIds.length} 个下载任务`);
}

async function startBatch(getTargets) {
  submitting = true;
  renderSelection();
  try {
    parseLines();
    await parseChain;
    await refresh();
    const targets = getTargets();
    if (!targets.length) return;
    await start(targets.map(item => item.id));
    for (const item of targets) selected.delete(item.groupKey);
  } finally {
    submitting = false;
    renderSelection(true);
  }
}

/* ---------- Parse ---------- */
// Share text becomes canonical URL-only jobs; serial requests resolve in the background without source tabs.
const parseJobs = new Map();
const parseByRequest = new Map();
let parseChain = Promise.resolve();
const linkLines = () => extractVideoURLs($('video-url').value);
function cleanInput() {
  $('video-url').value = linkLines().join('\n');
  fitInput();
}

function finishParse(job, state) {
  job.state = state;
  if (state.status === 'error') $('parse-results').open = true;
  if (state.status === 'ready') {
    const preferred = state.items.find(item => item.id === state.preferredId) || state.items[0];
    const key = videoGroups([preferred])[0].key;
    chosenFormats.set(key, preferred.id);
    parsedKeys.add(key); saveParsed();
    job.onReady?.(preferred);
  }
  if (state.status !== 'loading') { parseByRequest.delete(job.requestId); job.done?.(); }
  renderParse();
}

function enqueueParse(value, onReady) {
  const job = {value, onReady, requestId: crypto.randomUUID(), state: {status: 'queued', message: '等待解析'}};
  parseJobs.set(value, job);
  parseByRequest.set(job.requestId, job);
  parseChain = parseChain.then(() => new Promise(resolve => {
    job.done = resolve;
    job.state = {status: 'loading', message: '正在识别…'};
    renderParse();
    send({type: 'PARSE_URL', requestId: job.requestId, value: job.value})
      .catch(error => finishParse(job, {status: 'error', message: error.message}));
  }));
}

function parseLines(retryFailed = false) {
  clearTimeout(inputTimer);
  cleanInput();
  for (const value of linkLines()) {
    const job = parseJobs.get(value);
    if (!job || (retryFailed && job.state.status === 'error')) enqueueParse(value);
  }
  renderParse();
}

function resultRow(job) {
  const {status, message, sourceTabId} = job.state;
  const row = element('li', undefined, 'result');
  row.dataset.status = status;
  const state = element('span', undefined, 'result-state');
  state.append(status === 'loading' ? element('wa-spinner') : icon(status === 'ready' ? 'circle-check' : status === 'error' ? 'circle-alert' : 'link'));
  const text = element('span', undefined, 'result-text');
  const link = element('span', job.value.match(/https?:\/\/\S+/i)?.[0] || job.value, 'result-link ellipsis');
  link.title = job.value;
  const preferred = job.state.items?.find(item => item.id === job.state.preferredId) || job.state.items?.[0];
  const description = element('span', [preferred && qualityText(preferred), message].filter(Boolean).join(' · '), 'result-message');
  text.append(link, description);
  const actions = element('span', undefined, 'result-actions');
  if (status === 'error') {
    if (sourceTabId) {
      const open = iconButton('external-link', '打开来源网页', 'btn sm icon');
      open.onclick = () => void chrome.tabs.update(sourceTabId, {active: true}).catch(error => toast(error.message, true));
      actions.append(open);
    }
    const retry = iconButton('refresh-cw', '重试', 'btn sm icon');
    retry.onclick = () => { enqueueParse(job.value); renderParse(); };
    actions.append(retry);
  }
  row.append(state, text, actions);
  return row;
}

function renderParse() {
  const all = [...parseJobs.values()];
  const count = linkLines().length;
  $('link-count').textContent = count ? `${count} 个抖音链接` : '';
  $('parse-results').hidden = !all.length;
  const ready = all.filter(job => job.state.status === 'ready');
  const failed = all.filter(job => job.state.status === 'error').length;
  const pending = all.length - ready.length - failed;
  $('results-summary').textContent = [pending && `${pending} 个解析中`, ready.length && `${ready.length} 个完成`, failed && `${failed} 个失败`].filter(Boolean).join(' · ');
  $('parse-results').dataset.failed = String(failed > 0);
  $('results-clear').disabled = pending > 0;
  $('results-list').replaceChildren(...($('parse-results').open ? all.map(resultRow) : []));
}

$('parse-form').addEventListener('submit', event => { event.preventDefault(); parseLines(true); });
$('video-url').addEventListener('keydown', event => {
  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); parseLines(true); }
});
const fitInput = () => { $('video-url').style.height = 'auto'; $('video-url').style.height = `${$('video-url').scrollHeight}px`; };
$('video-url').addEventListener('blur', cleanInput);
$('video-url').addEventListener('input', event => {
  clearTimeout(inputTimer);
  fitInput();
  renderParse();
  if (!event.isComposing && linkLines().some(line => !parseJobs.has(line))) inputTimer = setTimeout(() => parseLines(), 800);
});

$('parse-results').addEventListener('toggle', renderParse);
$('results-clear').addEventListener('click', () => {
  for (const [value, job] of parseJobs) if (job.state.status !== 'loading' && job.state.status !== 'queued') parseJobs.delete(value);
  renderParse();
});

/* ---------- Toolbar ---------- */
$('select-all').addEventListener('change', () => {
  for (const item of visible) { if ($('select-all').checked) selected.add(item.groupKey); else selected.delete(item.groupKey); }
  renderSelection(true);
});
$('batch-download').addEventListener('click', () => {
  const keys = new Set(selected);
  void startBatch(() => parsed.filter(item => keys.has(item.groupKey))).catch(error => toast(error.message, true));
});
$('batch-copy').addEventListener('click', () => {
  const urls = parsed.filter(item => selected.has(item.groupKey)).map(item => item.url);
  void copyText(urls.join('\n'), `已复制 ${urls.length} 个视频地址`);
});
$('batch-clear').addEventListener('click', () => { selected.clear(); renderSelection(true); });
$('download-all').addEventListener('click', () => void startBatch(() => parsed).catch(error => toast(error.message, true)));
$('clear').addEventListener('click', async () => {
  try {
    if (capturedView) await send({type: 'CLEAR_MEDIA', ids: parsed.flatMap(item => item.formats.map(format => format.id)),
      ...(capturedTabId === null ? {} : {tabId: capturedTabId})});
    parsedKeys.clear(); saveParsed();
    chosenFormats.clear(); selected.clear();
    for (const [value, job] of parseJobs) if (!['loading', 'queued'].includes(job.state.status)) parseJobs.delete(value);
    if (capturedView) await refresh(); else renderMedia();
    renderParse();
    toast('已清空列表');
  } catch (error) { toast(error.message, true); }
});

/* ---------- Preview ---------- */
// An expired address is resolved again from the work page, then the fresh record is previewed.
const player = createPlayer({onRefresh(item, show) {
  if (!videoPage(item.sourceUrl)) { toast('视频地址已失效，请回到来源网页重新播放。', true); return; }
  enqueueParse(item.sourceUrl, show);
  renderParse();
}});
const openPreview = item => player.open(item);

/* ---------- Data ---------- */
let refreshPromise, refreshRequested = false;
function refresh() {
  refreshRequested = true;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    do {
      refreshRequested = false;
      const data = await readLibrary();
      items = data.items.sort((a, b) => b.createdAt - a.createdAt);
      jobs = data.jobs;
      jobsByMedia = indexDownloadJobs(jobs);
      $('library-status').hidden = true;
      renderMedia();
    } while (refreshRequested);
  })().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  for (const [key, change] of Object.entries(changes)) {
    const job = key.startsWith('parse:') && change.newValue && parseByRequest.get(key.slice(6));
    if (!job) continue;
    if (change.newValue.status === 'loading') { job.state = change.newValue; renderParse(); }
    else { finishParse(job, change.newValue); void chrome.storage.session.remove(key); }
  }
  if (Object.keys(changes).some(key => key.startsWith('media:')) || Object.values(changes).some(change => change.newValue?.status === 'ready')) {
    void refresh().catch(error => showLibraryError(error, refresh));
  } else if (Object.keys(changes).some(key => key.startsWith('job:'))) {
    // A library response already in flight may contain an older job snapshot.
    if (refreshPromise) refreshRequested = true;
    const changedIds = new Set();
    for (const [key, change] of Object.entries(changes)) if (key.startsWith('job:')) {
      if (change.oldValue) changedIds.add(change.oldValue.mediaId);
      if (change.newValue) changedIds.add(change.newValue.mediaId);
      const index = jobs.findIndex(job => `job:${job.id}` === key);
      if (!change.newValue) { if (index >= 0) jobs.splice(index, 1); }
      else if (index < 0) jobs.push(change.newValue); else jobs[index] = change.newValue;
    }
    jobsByMedia = indexDownloadJobs(jobs);
    renderDownloadProgress(changedIds);
  }
});
await loadResolutions();
await refresh().catch(error => showLibraryError(error, refresh));

const initialURL = pageURL.searchParams.get('url');
if (initialURL) {
  pageURL.searchParams.delete('url');
  history.replaceState(null, '', pageURL);
  $('video-url').value = initialURL;
  parseLines();
}
