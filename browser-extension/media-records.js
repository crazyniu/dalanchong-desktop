/**
 * AI module map
 * Purpose: pure source eligibility, media identity, size, deduplication, and work-grouping rules.
 * Entry: library.js, manager.js, and ui.js use the exported helpers.
 * Flow: URLs and capture metadata become stable media identities, preferred records, and per-work format groups using platforms.js recognition.
 * Invariants: selected signed-CDN query fields do not split one media identity; better metadata and verified sizes survive duplicate captures while fresh URLs remain usable.
 * Boundary: capture accepts every HTTP(S) source webpage and video CDN hostname.
 * Commerce panels retain their narrower routes. Owns no network, storage, or browser lifecycle.
 */
import {videoPage} from './platforms.js';

export const capturePagePatterns = ['http://*/*', 'https://*/*'];

export function canCaptureSource(value) {
  return /^https?:\/\//.test(value);
}

// A shared media file can belong to several tabs while retaining one library ID.
export function mediaTabIds(item) {
  return item.sourceTabIds || (Number.isInteger(item.sourceTabId) ? [item.sourceTabId] : []);
}

export function canCaptureCommerceSource(value) {
  if (!/^https:\/\//.test(value)) return false;
  const url = new URL(value);
  return ['www.douyin.com', 'www.kuaishou.com'].includes(url.hostname) ||
    (url.hostname === 'compass.jinritemai.com' && /^\/(talent\/(video-rank|product-rank)|shop\/chance)/.test(url.pathname)) ||
    (url.hostname === 'buyin.jinritemai.com' && /^\/(dashboard\/merch-picking-library\/merch-promoting|pc\/selection\/decision\/pack_detail)/.test(url.pathname));
}

export function mediaIdentity(value) {
  const url = new URL(value);
  url.hash = '';
  if (/(^|\.)(douyinvod\.com|idouyinvod\.com|bytecdn\.cn)$/.test(url.hostname)) {
    const path = url.pathname.includes('/video/tos/') ? url.pathname.slice(url.pathname.indexOf('/video/tos/')) : url.pathname;
    const format = new URLSearchParams([...url.searchParams].filter(([key]) => ['quality', 'ratio', 'format', 'watermark'].includes(key)));
    format.sort();
    return `cdn:${path}?${format}`;
  }
  return url.href;
}

export function mediaSize(status, header) {
  const total = header('content-range').match(/\/(\d+)$/)?.[1];
  if (total) return Number(total);
  return status === 200 && !header('content-encoding') ? Number(header('content-length')) || 0 : 0;
}

export function uniqueMedia(records) {
  const unique = new Map();
  const score = item => (item.quality && item.quality !== '网页视频' ? 2 : 0) + (item.awemeId || item.videoId ? 1 : 0);
  for (const item of records) {
    const key = mediaIdentity(item.url);
    const previous = unique.get(key);
    if (!previous) { unique.set(key, item); continue; }
    const preferred = score(item) > score(previous) || (score(item) === score(previous) && item.updatedAt > previous.updatedAt) ? item : previous;
    const newest = item.updatedAt > previous.updatedAt ? item : previous;
    const measured = newest.sizeVerified ? newest : preferred.sizeVerified ? preferred : null;
    const verified = newest.mediaVerified ? newest : preferred.url === newest.url && preferred.mediaVerified ? preferred : null;
    unique.set(key, {...preferred, url: newest.url, updatedAt: Math.max(item.updatedAt, previous.updatedAt),
      mediaVerified: Boolean(verified), mediaCheckedAt: verified?.mediaCheckedAt || newest.mediaCheckedAt,
      size: measured?.size || 0, sizeVerified: Boolean(measured),
      sizeCheckedAt: measured?.sizeCheckedAt || preferred.sizeCheckedAt});
  }
  return [...unique.values()];
}

export function videoGroupKey(item) {
  // Network observations can include preloaded recommendations from the same page.
  // Without work metadata, each media address represents its own captured video.
  if (item.quality === '网页视频') return mediaIdentity(item.url);
  const page = videoPage(item.sourceUrl);
  if (page) return `${page.platform}:${page.id}`;
  const source = new URL(item.sourceUrl);
  const kuaishouId = source.hostname === 'www.kuaishou.com' && source.pathname.match(/^\/short-video\/([^/]+)\/?$/)?.[1];
  return kuaishouId ? `kuaishou:${kuaishouId}` : mediaIdentity(item.url);
}

export function videoGroups(items) {
  const groups = new Map();
  const qualityScore = item => item.quality === '原片候选' ? 2 : 1;
  for (const item of items) {
    const key = videoGroupKey(item);
    if (!groups.has(key)) groups.set(key, {key, formats: []});
    groups.get(key).formats.push(item);
  }
  return [...groups.values()].map(group => ({...group, formats: group.formats.sort((a, b) => qualityScore(b) - qualityScore(a) || (b.height || 0) - (a.height || 0) || b.updatedAt - a.updatedAt)}));
}
