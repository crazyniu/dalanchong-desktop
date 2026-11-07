/**
 * AI module map
 * Purpose: extension action-popup controller for the captured media library.
 * Entry: popup.html loads this module; it reads the active tab and shared session records.
 * Flow: the current work identity or source tab scopes confirmed media and pending sources;
 * switching to the full library clears selection. Each row separates identity from quality/actions.
 * State: scope and selection are popup-local, while library.js owns media/jobs; storage changes refresh displayed progress and captured records.
 * Selection-only actions update existing checkboxes instead of rebuilding media rows and custom elements.
 * Invariants: only validated Douyin records are shown, including Compass/Buyin sources.
 * The chosen quality owns preview/copy/download together; the popup player disables fullscreen.
 * Side effects: background runtime requests, clipboard actions, DOM updates, and opening manager.html.
 */
import './vendor/ui/components.js';
import {videoPage} from './platforms.js';
import {createPlayer} from './player.js';
import {$, activeStates, copyText, downloadState, element, groupedItems, iconButton, indexDownloadJobs, loadResolutions, formatText, probeResolutions, qualitySelect, queue, readLibrary, send, showLibraryError, toast} from './ui.js';

// One row per work, selected by group key.
const selected = new Set();
const chosenFormats = new Map();
const renderedMedia = new Map();
let jobsByMedia = new Map();
let items = [], jobs = [], visible = [], pendingSources = [];
let scope = 'current', autoState, scopeMediaIds = new Set(), scopePendingCount = 0, libraryLoaded = false;
const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const tabURL = /^https?:/.test(tab?.url || '') ? new URL(tab.url) : null;
const page = tabURL ? videoPage(tab.url) : null;
function isCurrentSource(item) {
  if (!page) return item.sourceTabId === tab.id;
  const source = videoPage(item.sourceUrl);
  return source?.platform === page.platform && source.id === page.id;
}

// The popup is small: the preview fills its width, and fullscreen is not available in extension popups.
const player = createPlayer({fullscreen: false, bounds: () => ({maxWidth: innerWidth - 24, maxHeight: 300, minWidth: innerWidth - 24})});

$('open-workspace').addEventListener('click', () => {
  void chrome.tabs.create({url: chrome.runtime.getURL('manager.html#videos')});
  window.close();
});
for (const value of ['current', 'all']) $(`scope-${value}`).addEventListener('click', () => {
  if (scope === value) return;
  scope = value;
  selected.clear();
  render();
});

function itemRow(item) {
  const row = element('article', undefined, 'item');
  row.dataset.selected = String(selected.has(item.groupKey));
  const checkbox = element('wa-checkbox');
  checkbox.checked = selected.has(item.groupKey);
  checkbox.append(element('span', `选择 ${item.title}`, 'sr-only'));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.add(item.groupKey); else selected.delete(item.groupKey);
    row.dataset.selected = String(checkbox.checked);
    renderSelection();
  });
  const text = element('div', undefined, 'item-text');
  const title = element('div', item.title || '网页视频', 'item-title');
  title.title = item.title || '';
  const source = element('a', [item.author, new URL(item.sourceUrl).hostname].filter(Boolean).join(' · '), 'item-source ellipsis');
  source.href = item.sourceUrl; source.target = '_blank'; source.rel = 'noreferrer'; source.title = item.sourceUrl;
  const meta = element('div', undefined, 'item-meta');
  if (item.formats.length > 1) meta.append(qualitySelect(item, id => {
    chosenFormats.set(item.groupKey, id);
    render();
  }));
  else meta.textContent = formatText(item);
  text.append(title, source);
  const actions = element('div', undefined, 'item-actions');
  const preview = iconButton('eye', '预览', 'btn sm icon');
  preview.onclick = () => player.open(item);
  const copy = iconButton('copy', '复制视频地址', 'btn sm icon');
  copy.onclick = () => void copyText(item.url);
  const progress = downloadState(item, jobsByMedia, () => queue([item.id]));
  renderedMedia.set(item.id, {item, progress, row, checkbox});
  actions.append(preview, copy, progress);
  const controls = element('div', undefined, 'item-tools');
  controls.append(meta, actions);
  row.append(checkbox, text, controls);
  return row;
}

function renderSelection(updateRows = false) {
  if (updateRows) for (const {item, row, checkbox} of renderedMedia.values()) {
    checkbox.checked = selected.has(item.groupKey);
    row.dataset.selected = String(checkbox.checked);
  }
  const checked = visible.filter(item => selected.has(item.groupKey)).length;
  $('select-all').checked = visible.length > 0 && checked === visible.length;
  $('select-all').indeterminate = checked > 0 && checked < visible.length;
  $('select-all').disabled = visible.length === 0;
  const active = jobs.filter(job => activeStates.includes(job.status) && scopeMediaIds.has(job.mediaId)).length;
  $('batch').hidden = visible.length === 0 && !active;
  $('batch-download').hidden = visible.length === 0;
  $('batch-copy').disabled = checked === 0;
  $('batch-label').textContent = checked ? `下载所选（${checked}）` : `${scope === 'current' ? '下载当前页' : '全部下载'}（${visible.length}）`;
  $('batch-summary').textContent = [checked && `已选 ${checked} 个`, active && `${active} 个视频下载中`].filter(Boolean).join(' · ');
}

function render() {
  const scopedItems = scope === 'current' ? items.filter(isCurrentSource) : items;
  scopePendingCount = scope === 'current' ? pendingSources.filter(isCurrentSource).length : pendingSources.length;
  scopeMediaIds = new Set(scopedItems.map(item => item.id));
  visible = groupedItems(scopedItems, chosenFormats);
  const visibleKeys = new Set(visible.map(item => item.groupKey));
  for (const key of selected) if (!visibleKeys.has(key)) selected.delete(key);
  probeResolutions(visible.flatMap(item => item.formats), render);
  for (const value of ['current', 'all']) $(`scope-${value}`).setAttribute('aria-pressed', String(scope === value));
  $('scope-title').textContent = scope === 'current' ? tabURL?.hostname || '当前网页' : '全部视频';
  $('page-count').textContent = String(visible.length);
  $('clear').hidden = scope !== 'all' || items.length === 0;
  renderedMedia.clear();
  $('media-list').replaceChildren(...visible.map(itemRow));
  if (libraryLoaded) {
    $('library-status').hidden = scopePendingCount === 0;
    if (scopePendingCount > 0) $('library-status').replaceChildren(element('wa-spinner'), element('span', '正在识别视频…'));
  }
  $('empty').querySelector('strong').textContent = scope === 'current' ? '当前网页暂无视频' : '暂无视频';
  showAutoStatus(autoState);
  renderSelection();
}

function renderDownloadProgress(changedIds) {
  for (const row of renderedMedia.values()) {
    if (!row.item.formats.some(format => changedIds.has(format.id))) continue;
    const progress = downloadState(row.item, jobsByMedia, () => queue([row.item.id]));
    row.progress.replaceWith(progress);
    row.progress = progress;
  }
  renderSelection();
}

$('select-all').addEventListener('change', () => {
  for (const item of visible) { if ($('select-all').checked) selected.add(item.groupKey); else selected.delete(item.groupKey); }
  renderSelection(true);
});
$('batch-download').addEventListener('click', async () => {
  const chosen = visible.filter(item => selected.has(item.groupKey));
  const targets = chosen.length ? chosen : visible;
  if (!targets.length) return;
  $('batch-download').disabled = true;
  try {
    const {jobIds} = await queue(targets.map(item => item.id));
    for (const item of targets) selected.delete(item.groupKey);
    toast(`已添加 ${jobIds.length} 个下载任务`);
    renderSelection(true);
  } catch (error) { toast(error.message, true); }
  finally { $('batch-download').disabled = false; }
});
$('batch-copy').addEventListener('click', () => {
  const urls = visible.filter(item => selected.has(item.groupKey)).map(item => item.url);
  void copyText(urls.join('\n'), `已复制 ${urls.length} 个视频地址`);
});
$('clear').addEventListener('click', async () => {
  try {
    await send({type: 'CLEAR_LIBRARY'});
    selected.clear(); chosenFormats.clear();
    await refresh();
    toast('已清空列表');
  } catch (error) { toast(error.message, true); }
});

/* ---------- Auto-parse the work open in the current tab ---------- */
// The page's own player often only streams a compressed copy, so the work page is parsed once for its original file.
function showAutoStatus(state) {
  autoState = state;
  $('auto-status').hidden = scope !== 'current' || !state || state.status === 'ready';
  $('empty').hidden = !libraryLoaded || visible.length > 0 || scopePendingCount > 0 || (scope === 'current' && state?.status === 'loading');
  if (!state) return;
  $('auto-status').dataset.status = state.status;
  $('auto-text').textContent = state.status === 'error' ? `当前作品解析失败：${state.message}` : state.message || '正在解析当前作品…';
}
async function autoParse() {
  if (!page) return;
  const parsed = items.some(item => item.quality !== '网页视频' && isCurrentSource(item));
  const key = `video:${tab.id}`;
  const current = (await chrome.storage.session.get(key))[key];
  if (parsed) return;
  if (current?.status === 'loading' && current.awemeId === page.id) { showAutoStatus(current); return; }
  showAutoStatus({status: 'loading'});
  await send({type: 'ANALYZE', tabId: tab.id, quality: 'original'}).catch(error => showAutoStatus({status: 'error', message: error.message}));
}
chrome.storage.onChanged.addListener((changes, area) => {
  const change = area === 'session' && page && changes[`video:${tab.id}`];
  if (change?.newValue) showAutoStatus(change.newValue);
});

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
      pendingSources = data.pendingSources;
      libraryLoaded = true;
      render();
    } while (refreshRequested);
  })().finally(() => { refreshPromise = undefined; });
  return refreshPromise;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (Object.keys(changes).some(key => key.startsWith('media:'))) { void refresh().catch(error => showLibraryError(error, refresh)); return; }
  const changedIds = new Set();
  for (const [key, change] of Object.entries(changes)) if (key.startsWith('job:')) {
    if (change.oldValue) changedIds.add(change.oldValue.mediaId);
    if (change.newValue) changedIds.add(change.newValue.mediaId);
    const index = jobs.findIndex(job => `job:${job.id}` === key);
    if (!change.newValue) { if (index >= 0) jobs.splice(index, 1); }
    else if (index < 0) jobs.push(change.newValue); else jobs[index] = change.newValue;
  }
  if (changedIds.size) {
    if (refreshPromise) refreshRequested = true;
    jobsByMedia = indexDownloadJobs(jobs);
    renderDownloadProgress(changedIds);
  }
});
await loadResolutions();
await refresh().catch(error => showLibraryError(error, refresh));
if (libraryLoaded) void autoParse();
