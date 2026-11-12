/**
 * AI module map
 * Action popup for all verified captured videos in this browser profile. The background owns media and jobs;
 * selection and quality choices stay local. Preview opens over the current webpage
 * through the background, without closing this list or moving its focus.
 * Each row links the selected format's actual playback URL in a new tab.
 * The footer queues all displayed videos or selected groups with their chosen formats.
 * Video tracing opens manager.html with all captured videos and optional selected
 * media IDs, without starting transfers. Submission state prevents duplicate clicks.
 */
import './vendor/ui/components.js';
import {$, copyText, downloadState, element, groupedItems, iconButton, indexDownloadJobs, loadResolutions, qualitySelect, qualityText, queue, readLibrary, send, showLibraryError, sizeText, toast} from './ui.js';

const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
const selected = new Set();
const chosenFormats = new Map();
const rows = new Map();
let items = [], visible = [], jobsByMedia = new Map();
let clearing = false, submitting = false;

function renderSelection() {
  for (const {item, checkbox, row} of rows.values()) {
    checkbox.checked = selected.has(item.groupKey);
    row.dataset.selected = String(checkbox.checked);
  }
  $('select-all').disabled = visible.length === 0;
  $('select-all').checked = visible.length > 0 && selected.size === visible.length;
  $('select-all').indeterminate = selected.size > 0 && selected.size < visible.length;
  $('selection-count').textContent = selected.size ? `已选 ${selected.size} 个` : '';
  $('clear').disabled = clearing || submitting || visible.length === 0;
  $('batch-actions').hidden = visible.length === 0;
  $('batch-download').disabled = submitting || clearing || visible.length === 0;
  $('batch-download').setAttribute('aria-busy', String(submitting));
  $('batch-download-label').textContent = submitting ? '正在提交…' : selected.size ? '下载所选' : '全部下载';
}

function itemRow(item) {
  const row = element('article', undefined, 'item');
  const checkbox = element('wa-checkbox');
  checkbox.append(element('span', `选择 ${item.title}`, 'sr-only'));
  checkbox.addEventListener('change', () => {
    if (checkbox.checked) selected.add(item.groupKey); else selected.delete(item.groupKey);
    renderSelection();
  });
  const text = element('div', undefined, 'item-text');
  const title = element('div', item.title || '网页视频', 'item-title');
  title.title = item.title || '';
  const source = element('a', item.url, 'item-source ellipsis');
  source.href = item.url; source.target = '_blank'; source.rel = 'noopener noreferrer'; source.title = item.url;
  text.append(title, source);
  const meta = element('div', undefined, 'item-meta');
  if (item.formats.length > 1) meta.append(qualitySelect(item, id => { chosenFormats.set(item.groupKey, id); render(); }));
  else meta.textContent = [qualityText(item), sizeText(item.size)].filter(Boolean).join(' · ');
  const actions = element('div', undefined, 'item-actions');
  const preview = iconButton('eye', '预览', 'btn sm icon');
  preview.onclick = async () => {
    preview.disabled = true;
    try {
      const result = await send({type: 'PREVIEW_MEDIA', mediaId: item.id, tabId: tab.id});
      if (result?.ok !== true) throw new Error('视频预览未打开，请重试。');
    } catch (error) { toast(error.message, true); }
    finally { preview.disabled = false; }
  };
  const copy = iconButton('copy', '复制视频地址', 'btn sm icon');
  copy.onclick = () => void copyText(item.url);
  const progress = downloadState(item, jobsByMedia, () => download(item));
  actions.append(preview, copy, progress);
  const tools = element('div', undefined, 'item-tools');
  tools.append(meta, actions);
  row.append(checkbox, text, tools);
  rows.set(item.id, {item, checkbox, row, progress});
  return row;
}

async function download(item) {
  await queue([item.id]);
  toast('已添加下载任务');
}

function render() {
  visible = groupedItems(items, chosenFormats);
  const keys = new Set(visible.map(item => item.groupKey));
  for (const key of selected) if (!keys.has(key)) selected.delete(key);
  rows.clear();
  $('media-list').replaceChildren(...visible.map(itemRow));
  $('page-count').textContent = String(visible.length);
  $('empty').hidden = visible.length > 0;
  renderSelection();
}

$('select-all').addEventListener('change', () => {
  for (const item of visible) {
    if ($('select-all').checked) selected.add(item.groupKey); else selected.delete(item.groupKey);
  }
  renderSelection();
});
$('batch-download').addEventListener('click', async () => {
  const ids = visible.filter(item => selected.size === 0 || selected.has(item.groupKey)).map(item => item.id);
  submitting = true;
  renderSelection();
  try {
    await queue(ids);
    toast(`已添加 ${ids.length} 个下载任务`);
  } catch (error) { toast(error.message, true); }
  finally {
    submitting = false;
    renderSelection();
  }
});
$('clear').addEventListener('click', async () => {
  const ids = visible.flatMap(item => item.formats.map(format => format.id));
  clearing = true;
  renderSelection();
  try {
    await send({type: 'CLEAR_MEDIA', ids});
    selected.clear();
    chosenFormats.clear();
    await refresh();
    toast('已清空列表');
  } catch (error) { toast(error.message, true); }
  finally {
    clearing = false;
    renderSelection();
  }
});
$('open-workspace').addEventListener('click', async () => {
  const url = new URL(chrome.runtime.getURL('manager.html'));
  url.searchParams.set('view', 'captured');
  if (selected.size) url.searchParams.set('ids', visible.filter(item => selected.has(item.groupKey)).map(item => item.id).join(','));
  await chrome.tabs.create({url: url.href});
  window.close();
});

async function refresh() {
  const data = await readLibrary();
  items = data.items.sort((a, b) => b.createdAt - a.createdAt);
  jobsByMedia = indexDownloadJobs(data.jobs);
  $('library-status').hidden = true;
  render();
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  if (Object.keys(changes).some(key => key.startsWith('media:'))) {
    void refresh().catch(error => showLibraryError(error, refresh));
    return;
  }
  for (const [key, change] of Object.entries(changes)) {
    if (!key.startsWith('job:') || !change.newValue) continue;
    const job = change.newValue;
    const previous = jobsByMedia.get(job.mediaId);
    if (previous && previous.createdAt > job.createdAt) continue;
    jobsByMedia.set(job.mediaId, job);
    const entry = rows.get(job.mediaId);
    if (!entry) continue;
    const progress = downloadState(entry.item, jobsByMedia, () => download(entry.item));
    entry.progress.replaceWith(progress);
    entry.progress = progress;
  }
});
await loadResolutions();
await refresh().catch(error => showLibraryError(error, refresh));
