/**
 * AI module map
 * Purpose: Douyin batch link parsing, selected quality, copying, downloads and previews.
 * Entry: manager.html loads this single-page workspace, including the shop bookmark.
 * Flow: compact share-link input calls background PARSE_URL; collapsible parse records
 * accompany the main video list, and its fixed batch bar copies or queues selected formats.
 * State: parsed group keys persist in page sessionStorage; selection uses those same
 * work keys while format choices remain local. chrome.storage.session supplies validated
 * media/jobs. Queue options are fixed, and parse jobs are keyed by link plus quality.
 * Each media render computes grouping once; selection-only changes reuse rendered rows.
 * Invariants: this page lists works parsed here; popup.js presents the captured-page library. Parsing is serialized and each request retains its selected quality.
 * Side effects: runtime messages, storage listeners, clipboard writes, parser timers, DOM updates, and player.js previews.
 */
import './vendor/ui/components.js';
import {createPlayer} from './player.js';
import {videoGroups} from './media-records.js';
import {$, activeStates, copyText, downloadState, element, groupedItems, icon, iconButton, indexDownloadJobs, loadResolutions, probeResolutions, qualitySelect, qualityText, queue, readLibrary, send, showLibraryError, sizeText, thumb, toast} from './ui.js';

const selected = new Set();
const chosenFormats = new Map();
const renderedMedia = new Map();
let jobsByMedia = new Map(), parsedMediaIds = new Set();
let items = [], jobs = [], inputTimer;
let parsed = [], visible = [], submitting = false;
const pageURL = new URL(location.href);
// This page only lists works parsed here; videos captured on other pages are shown in the popup.
const parsedKeys = new Set(JSON.parse(sessionStorage.getItem('parsedKeys') || '[]'));
const saveParsed = () => sessionStorage.setItem('parsedKeys', JSON.stringify([...parsedKeys]));
const isDouyinLink = line => /https?:\/\/[^\s]*(douyin\.com|iesdouyin\.com)/i.test(line);

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
  if (item.videoOnly) meta.append(element('span', '自动合并音轨', 'pill'));
  if (item.kind === 'hls' && !item.quality?.includes('HLS')) meta.append(element('span', 'HLS', 'pill'));
  const source = element('a', new URL(item.sourceUrl).hostname, 'source ellipsis');
  source.href = item.sourceUrl; source.target = '_blank'; source.rel = 'noreferrer'; source.title = item.sourceUrl;
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
  parsed = groupedItems(items, chosenFormats).filter(item => parsedKeys.has(item.groupKey));
  const currentKeys = new Set(parsed.map(item => item.groupKey));
  for (const key of selected) if (!currentKeys.has(key)) selected.delete(key);
  const query = $('search').value.trim().toLowerCase();
  visible = parsed.filter(item => `${item.title} ${item.author || ''} ${item.sourceUrl}`.toLowerCase().includes(query));
  const total = parsed.length;
  probeResolutions(visible.flatMap(item => item.formats), renderMedia);
  $('visible-count').textContent = query ? `${visible.length} / ${total}` : String(total);
  $('table-head').hidden = visible.length === 0;
  $('empty').hidden = visible.length > 0;
  $('empty').querySelector('h3').textContent = total ? '没有匹配的视频' : '暂无视频';
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

async function startBatch(targets) {
  submitting = true;
  renderSelection();
  try {
    await start(targets.map(item => item.id));
    for (const item of targets) selected.delete(item.groupKey);
  } finally {
    submitting = false;
    renderSelection(true);
  }
}

/* ---------- Parse ---------- */
// One request per line, run one after another so platform pages are not opened all at once.
const parseJobs = new Map();
const parseByRequest = new Map();
let parseChain = Promise.resolve(), filtersReset = false;
const allLinkLines = () => [...new Set($('video-url').value.split('\n').map(line => line.trim()).filter(line => /https?:\/\/\S+\.\S+/i.test(line)))];
const linkLines = () => allLinkLines().filter(isDouyinLink);
const parseKey = (value, quality = $('parse-quality').value) => `${quality}\n${value}`;

function finishParse(job, state) {
  job.state = state;
  if (state.status === 'ready') {
    const preferred = state.items.find(item => item.id === state.preferredId) || state.items[0];
    const key = videoGroups([preferred])[0].key;
    chosenFormats.set(key, preferred.id);
    parsedKeys.add(key); saveParsed();
    selected.add(key);
    job.onReady?.(preferred);
    if (!filtersReset) { $('search').value = ''; filtersReset = true; }
  }
  if (state.status !== 'loading') { parseByRequest.delete(job.requestId); job.done?.(); }
  renderParse();
}

function enqueueParse(value, onReady, quality = $('parse-quality').value) {
  const job = {value, onReady, requestId: crypto.randomUUID(), quality, state: {status: 'queued', message: '等待解析'}};
  parseJobs.set(parseKey(value, quality), job);
  parseByRequest.set(job.requestId, job);
  parseChain = parseChain.then(() => new Promise(resolve => {
    job.done = resolve;
    job.state = {status: 'loading', message: '正在识别…'};
    renderParse();
    send({type: 'PARSE_URL', requestId: job.requestId, value: job.value, quality: job.quality})
      .catch(error => finishParse(job, {status: 'error', message: error.message}));
  }));
}

function parseLines(retryFailed = false) {
  clearTimeout(inputTimer);
  filtersReset = false;
  for (const value of linkLines()) {
    const job = parseJobs.get(parseKey(value));
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
  text.append(link, element('span', `${job.quality === 'original' ? '原片' : '高清'} · ${message}`, 'result-message ellipsis'));
  const actions = element('span', undefined, 'result-actions');
  if (status === 'error') {
    if (sourceTabId) {
      const open = iconButton('external-link', '打开来源网页', 'btn sm icon');
      open.onclick = () => void chrome.tabs.update(sourceTabId, {active: true}).catch(error => toast(error.message, true));
      actions.append(open);
    }
    const retry = iconButton('refresh-cw', '重试', 'btn sm icon');
    retry.onclick = () => { enqueueParse(job.value, undefined, job.quality); renderParse(); };
    actions.append(retry);
  }
  row.append(state, text, actions);
  return row;
}

function renderParse() {
  const all = [...parseJobs.values()];
  const count = linkLines().length;
  const skipped = allLinkLines().length - count;
  $('link-count').textContent = [count && `${count} 个抖音链接`, skipped && `已忽略 ${skipped} 个非抖音链接`].filter(Boolean).join(' · ');
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
$('video-url').addEventListener('input', event => {
  clearTimeout(inputTimer);
  fitInput();
  renderParse();
  if (!event.isComposing && linkLines().some(line => !parseJobs.has(parseKey(line)))) inputTimer = setTimeout(() => parseLines(), 800);
});
$('parse-quality').addEventListener('change', () => parseLines());
$('parse-results').addEventListener('toggle', renderParse);
$('results-clear').addEventListener('click', () => {
  for (const [value, job] of parseJobs) if (job.state.status !== 'loading' && job.state.status !== 'queued') parseJobs.delete(value);
  renderParse();
});

/* ---------- Toolbar ---------- */
$('search').addEventListener('input', renderMedia);
$('search').addEventListener('wa-clear', renderMedia);
$('select-all').addEventListener('change', () => {
  for (const item of visible) { if ($('select-all').checked) selected.add(item.groupKey); else selected.delete(item.groupKey); }
  renderSelection(true);
});
$('batch-download').addEventListener('click', () => void startBatch(parsed.filter(item => selected.has(item.groupKey))).catch(error => toast(error.message, true)));
$('batch-copy').addEventListener('click', () => {
  const urls = parsed.filter(item => selected.has(item.groupKey)).map(item => item.url);
  void copyText(urls.join('\n'), `已复制 ${urls.length} 个视频地址`);
});
$('batch-clear').addEventListener('click', () => { selected.clear(); renderSelection(true); });
$('download-all').addEventListener('click', () => void startBatch(parsed).catch(error => toast(error.message, true)));
$('clear').addEventListener('click', async () => {
  try {
    parsedKeys.clear(); saveParsed();
    chosenFormats.clear(); selected.clear();
    for (const [value, job] of parseJobs) if (!['loading', 'queued'].includes(job.state.status)) parseJobs.delete(value);
    renderMedia(); renderParse();
    toast('已清空列表');
  } catch (error) { toast(error.message, true); }
});

/* ---------- Preview ---------- */
// An expired address is resolved again from the work page, then the fresh record is previewed.
const player = createPlayer({onRefresh(item, show) {
  enqueueParse(item.sourceUrl, show, item.quality === '原片候选' ? 'original' : 'hd');
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
      items = data.items.filter(item => item.platform === '抖音').sort((a, b) => b.createdAt - a.createdAt);
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
