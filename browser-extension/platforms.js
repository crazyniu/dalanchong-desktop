/**
 * AI module map
 * Purpose: pure platform naming and supported work/CDN URL recognition.
 * Entry: exports platformNames, videoPage, and isMediaURL to analysis, library, resolver, and UI modules.
 * Flow: supported HTTPS work URLs become platform/work identifiers; the explicit CDN rules identify supported direct media URLs.
 * Boundary: URL recognition does not fetch, authenticate, persist records, or establish download completion.
 */
export const platformNames = {douyin: "抖音"};

export function videoPage(url) {
  const parsed = new URL(url);
  const host = parsed.hostname;
  if (parsed.protocol !== "https:" || host !== "www.douyin.com") return null;
  const id = parsed.searchParams.get("modal_id") || parsed.searchParams.get("vid") || parsed.pathname.match(/^\/video\/(\d+)/)?.[1];
  return /^\d+$/.test(id || "") ? {platform: 'douyin', id} : null;
}

export function isMediaURL(url) {
  const parsed = new URL(url);
  const domains = ["douyinvod.com", "idouyinvod.com", "ixigua.com", "365yg.com", "bytecdn.cn", "amemv.com", "snssdk.com", "toutiaovod.com"];
  return parsed.protocol === "https:" && domains.some(domain => parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`));
}
