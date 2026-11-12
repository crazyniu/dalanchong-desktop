/**
 * AI module map
 * Purpose: save complete videos requested or played in HTTP(S) webpages and frames.
 * Entry: capture.js reports decoded players; webRequest reports successful video responses.
 * Flow: the real top-level tab owns the source; response types or decoded playback
 * establish video identity without extra requests, including files behind blob players.
 * State: one entry per tab/media URL coalesces unchanged metadata. Network responses
 * can supply file size and DOM reports add dimensions; clearing releases the entry.
 * Boundary: CDN hosts are unrestricted; blob URLs, audio and segments are not files.
 */
import {addMedia} from './library.js';
import {mediaType} from './media.js';
import {canCaptureSource, capturePagePatterns, mediaSize, mediaTabIds} from './media-records.js';
import {listenMessages} from './messages.js';

const captured = new Map();
const excludedPath = /\.(ts|m4s|m3u8|mpd|vtt|mp3|m4a|aac|wav|flac)(?:$|[?#])/i;

function saveCapture(item, tab) {
  if (!canCaptureSource(tab.url)) return;
  const key = `${tab.id}:${item.url}`;
  const previous = captured.get(key);
  const sameSource = previous?.sourceUrl === tab.url;
  if (sameSource && Object.entries(item).every(([name, value]) => previous.metadata[name] === value)) return previous.promise;
  const entry = {tabId: tab.id, sourceUrl: tab.url,
    metadata: {...(sameSource ? previous.metadata : {}), ...item}};
  entry.promise = addMedia({...entry.metadata, kind: 'video', mediaVerified: true,
    ...(item.size ? {sizeCheckedAt: Date.now()} : {}),
    mediaCheckedAt: Date.now(), title: tab.title || '网页视频', sourceUrl: tab.url,
    sourceTabId: tab.id, quality: '网页视频'}).then(record => {
    entry.mediaId = record.id;
    return record;
  }, error => {
    if (captured.get(key) === entry) captured.delete(key);
    throw error;
  });
  captured.set(key, entry);
  return entry.promise;
}

async function capture(item, tab) {
  const playback = item.playback;
  if (!/^https?:/.test(item.url) || excludedPath.test(item.url) ||
      playback?.currentSrc !== item.url || playback.readyState < 2 ||
      !(playback.videoWidth > 0 && playback.videoHeight > 0)) return;
  return saveCapture({url: item.url, width: playback.videoWidth, height: playback.videoHeight}, tab);
}

listenMessages(new Set(['CAPTURE_MEDIA']), (message, sender, respond) => {
  if (!sender.tab) { respond({error: '未找到来源网页。'}); return; }
  capture(message.item, sender.tab)
    .then(() => respond({ok: true}), error => respond({error: error.message}));
});

// Capture the actual media response even when its player exposes only a blob URL
// or lives in an iframe. Range responses still identify the complete file URL;
// playlists, segments and audio are excluded instead of appearing as whole videos.
chrome.webRequest.onHeadersReceived.addListener(details => {
  if (details.tabId < 0 || details.statusCode < 200 || details.statusCode >= 300 || excludedPath.test(details.url)) return;
  const header = name => details.responseHeaders.find(item => item.name.toLowerCase() === name)?.value || '';
  const contentType = header('content-type');
  const mime = contentType.split(';')[0].trim().toLowerCase();
  const entry = captured.get(`${details.tabId}:${details.url}`);
  // Opaque endpoints without a video extension need a decoded player report;
  // explicit video MIME types also support extensionless CDN video URLs.
  if (mediaType(details.url, contentType) !== 'video' &&
      !(entry && (!mime || ['application/octet-stream', 'binary/octet-stream'].includes(mime)))) return;
  const size = mediaSize(details.statusCode, header);
  const metadata = {url: details.url, ...(contentType ? {contentType} : {}),
    ...(size ? {size, sizeVerified: true} : {})};
  void chrome.tabs.get(details.tabId).then(tab => saveCapture(metadata, tab))
    .catch(error => console.debug('视频响应未保存', error.message));
}, {urls: ['http://*/*', 'https://*/*']}, ['responseHeaders']);

chrome.tabs.onRemoved.addListener(tabId => {
  for (const [key, entry] of captured) if (entry.tabId === tabId) captured.delete(key);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session') return;
  for (const [key, {oldValue, newValue}] of Object.entries(changes)) {
    if (!key.startsWith('media:') || !oldValue) continue;
    const tabs = newValue ? mediaTabIds(newValue) : [];
    for (const [captureKey, entry] of captured) {
      if (entry.mediaId === oldValue.id && !tabs.includes(entry.tabId)) captured.delete(captureKey);
    }
  }
});

function watchTab(tab) {
  if (!canCaptureSource(tab.url) || tab.discarded) return;
  return chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, files: ['capture.js']})
    .catch(error => console.debug('视频监听未注入', error.message));
}

// Include already-loaded players and frames when the extension or tab starts.
void chrome.tabs.query({url: capturePagePatterns}).then(tabs => Promise.all(tabs.map(watchTab)));
chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (change.status === 'complete') void watchTab(tab);
});
