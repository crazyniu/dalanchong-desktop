/**
 * AI module map
 * Purpose: extract Douyin links from share text and resolve works without opening tabs.
 * Entry: manager.js uses extractVideoURLs; background.js calls resolveVideoURL with its page-context resolver.
 * Flow: direct links supply the work ID; short-link HTTP redirects reveal it. The supplied resolver reads that ID in an existing Douyin page's MAIN world and saves verified media.
 * State: link resolution belongs to this request; browser context and media persistence belong to background.js.
 * Invariants: never navigate or create browser tabs; only the requested work is returned, and verification/login failures remain explicit errors.
 * Side effects: short-link HTTP requests and the supplied resolver. Download scheduling remains caller-owned.
 */

export function extractVideoURLs(value) {
  const links = value.match(/https?:\/\/[^\s<>"'，。！？；、]+/gi) || [];
  return [...new Set(links.flatMap(link => {
    // Share text is untrusted input; malformed and unrelated URLs are discarded.
    try {
      const url = new URL(link.replace(/[)）\]】.,;!?]+$/, ''));
      return url.protocol === 'https:' && /(^|\.)(douyin\.com|iesdouyin\.com)$/.test(url.hostname) ? [url.href] : [];
    } catch { return []; }
  }))];
}

export function extractVideoURL(value) {
  const [url] = extractVideoURLs(value);
  if (!url) throw new Error('请输入抖音作品或分享链接。');
  return url;
}

function workId(url) {
  const parsed = new URL(url);
  return parsed.searchParams.get('modal_id') || parsed.searchParams.get('vid')
    || parsed.pathname.match(/^\/(?:share\/)?video\/(\d+)/)?.[1];
}

export async function resolveVideoURL(value, {onProgress, resolveWork}) {
  const url = extractVideoURL(value);
  let id = workId(url);
  if (!id) {
    await onProgress({message: '正在展开抖音分享链接…'});
    const response = await fetch(url, {credentials: 'include', redirect: 'follow', signal: AbortSignal.timeout(30000)});
    try {
      if (!response.ok) throw new Error(`分享链接返回 HTTP ${response.status}。`);
      id = workId(extractVideoURL(response.url));
    } finally {
      await response.body?.cancel();
    }
  }
  if (!/^\d+$/.test(id || '')) throw new Error('链接未返回抖音视频作品，请完成登录或验证后重试。');
  await onProgress({message: '正在读取抖音作品…'});
  const result = await resolveWork(id, onProgress);
  const sourceUrl = `https://www.douyin.com/video/${id}`;
  return {items: [result], preferredId: result.id, url: sourceUrl};
}
