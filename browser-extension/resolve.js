/**
 * AI module map
 * Purpose: resolve Douyin share text and work URLs into verified extension media records.
 * Entry: background.js calls resolveVideoURL with platform-analysis and progress callbacks.
 * Flow: extracts a Douyin URL and reuses/opens its source tab; page.js analysis returns only that work’s verified media.
 * State: tab-load listeners and timers belong to each resolution request and are cleaned up when it settles.
 * Invariants: opening a tab alone is not a successful parse; the request returns discovered media or propagates the actual resolution error.
 * Side effects: browser tab operations, Douyin page analysis through the supplied callback.
 */
import {videoPage} from './platforms.js';

export function extractVideoURL(value) {
  const match = value.match(/https?:\/\/[^\s<>"'，。！？；、]+/i);
  if (!match) throw new Error('请输入完整的 http 或 https 视频网址，也可以直接粘贴分享文案。');
  const url = new URL(match[0].replace(/[)）\]】.,;!?]+$/, ''));
  if (url.protocol !== 'https:' || !/(^|\.)(douyin\.com|iesdouyin\.com)$/.test(url.hostname)) throw new Error('请输入抖音作品或分享链接。');
  return url.href;
}

function samePage(first, second) {
  const a = videoPage(first), b = videoPage(second);
  return a && b ? a.platform === b.platform && a.id === b.id : first === second;
}

function waitForPage(tabId) {
  return new Promise((resolve, reject) => {
    const finish = (error, tab) => {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(updated);
      chrome.tabs.onRemoved.removeListener(removed);
      if (error) reject(error); else resolve(tab);
    };
    const updated = (id, change, tab) => {
      if (id === tabId && change.status === 'complete') finish(null, tab);
    };
    const removed = id => { if (id === tabId) finish(new Error('解析网页已关闭，请重新解析链接。')); };
    const timer = setTimeout(() => finish(new Error('网页加载超时，请打开来源网页完成登录或验证后重试。')), 30000);
    chrome.tabs.onUpdated.addListener(updated);
    chrome.tabs.onRemoved.addListener(removed);
    chrome.tabs.get(tabId).then(tab => { if (tab.status === 'complete') finish(null, tab); }, error => finish(error));
  });
}

export async function resolveVideoURL(value, {quality, onProgress, analyze}) {
  const url = extractVideoURL(value);
  await onProgress({message: '正在识别抖音链接…'});
  const tabs = await chrome.tabs.query({});
  let tab = tabs.find(tab => /^https?:/.test(tab.url || '') && samePage(tab.url, url));
  if (!tab) tab = await chrome.tabs.create({url, active: false});
  await onProgress({message: '正在加载视频网页，复用浏览器登录态…', sourceTabId: tab.id});
  tab = await waitForPage(tab.id);
  if (!videoPage(tab.url)) throw new Error('链接未打开抖音视频作品，请在来源网页完成登录或验证后重试。');
  await onProgress({message: '正在提取视频下载地址…', sourceTabId: tab.id});
  const result = await analyze(tab.id, quality);
  // Only this work's detail-derived result belongs to the request. Other media
  // loaded by the same tab can be recommendations or unrelated player assets.
  return {items: [{...result, id: result.mediaId}], sourceTabId: tab.id, preferredId: result.mediaId, url: tab.url};
}
