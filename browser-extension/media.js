/**
 * AI module map
 * Purpose: complete-video URL/type helpers, filenames and response-confirmed media metadata.
 * Entry: library.js and commerce-background.js use naming, normalization and probing.
 * Flow: a short range request verifies video bytes and file size before Chrome downloads; original-node resolution opts out of cached redirects.
 * Invariants: reject images, audio and segmented playlists as complete video files.
 * Boundary: this module does not own job persistence or Chrome's final save operation.
 */
import {mediaSize} from './media-records.js';
import {isMediaURL} from './platforms.js';

export function platformName(value) {
  const host = new URL(value).hostname;
  if (/(^|\.)(kuaishou\.com|kwaixiaodian\.com)$/.test(host)) return '快手';
  if (/(^|\.)(douyin\.com|iesdouyin\.com|jinritemai\.com)$/.test(host)) return '抖音';
  return '网页视频';
}

export function normalizeMediaURL(value) {
  const url = new URL(value);
  url.hash = '';
  return url.href;
}

export function mediaType(url, contentType = '') {
  const mime = contentType.split(';')[0].trim().toLowerCase();
  if (/video\/(mp2t|iso\.segment)/.test(mime)) return null;
  const parsed = new URL(url), path = parsed.pathname;
  if (/\.(ts|m4s|vtt)(?:$|\/)/i.test(path)) return null;
  if (/\.(mp3|m4a|aac|wav|flac)(?:$|\/)/i.test(path)) return 'audio';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  // A video-looking URL cannot override an image, HTML, JSON or other explicit type.
  if (mime && !['application/octet-stream', 'binary/octet-stream'].includes(mime)) return null;
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(path)) return 'video';
  if (isMediaURL(url) && (path.includes('/video/tos/') || parsed.searchParams.get('mime_type') === 'video_mp4')) return 'video';
  return null;
}

const mediaProbes = new Map();
export function probeMediaFile(url, {trustedVideo = false, credentials = 'include', cache = 'default'} = {}) {
  // DOM capture and both commerce caches can discover the same request together.
  const key = `${trustedVideo}:${credentials}:${cache}:${url}`;
  if (!mediaProbes.has(key)) mediaProbes.set(key, inspectMediaFile(url, trustedVideo, credentials, cache).finally(() => mediaProbes.delete(key)));
  return mediaProbes.get(key);
}

async function inspectMediaFile(url, trustedVideo, credentials, cache) {
  const response = await fetch(url, {headers: {Range: 'bytes=0-511'}, credentials, cache, signal: AbortSignal.timeout(15000)});
  const responseInfo = {origin: new URL(response.url).origin, httpStatus: response.status,
    contentType: response.headers.get('content-type') || ''};
  try {
    if (!response.ok) throw new Error(`视频地址返回 HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    const mime = contentType.split(';')[0].trim().toLowerCase();
    let kind = mediaType(response.url, contentType);
    const parsed = new URL(response.url);
    const videoSource = trustedVideo || (isMediaURL(response.url) && (parsed.pathname.includes('/video/tos/') || parsed.searchParams.get('mime_type') === 'video_mp4'));
    if (kind === 'audio' || /\.(ts|m4s|vtt)(?:$|\/)/i.test(parsed.pathname)) throw new Error('地址未返回完整视频文件。');
    if (!mime || ['application/octet-stream', 'binary/octet-stream'].includes(mime)) {
      // Some Douyin CDNs return octet-stream without a media extension. Inspect
      // only the opening chunk, then cancel even if the CDN ignored Range.
      const reader = response.body.getReader();
      const header = new Uint8Array(32);
      let length = 0;
      try {
        while (length < header.length) {
          const {done, value} = await reader.read();
          if (done) break;
          const part = value.subarray(0, header.length - length);
          header.set(part, length); length += part.length;
        }
      }
      finally { await reader.cancel(); }
      const text = new TextDecoder('latin1').decode(header.subarray(0, length));
      // MP4 containers can also hold audio. Opaque responses additionally
      // require a video field from the detail API or a known Douyin video path.
      if (videoSource && text.slice(4, 8) === 'ftyp' && !/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1|M4A |M4B |M4P )$/.test(text.slice(8, 12))) kind = 'video';
      else throw new Error('地址未返回可确认的视频文件。');
    }
    if (!kind || kind === 'audio') throw new Error('地址未返回可下载视频。');
    const size = mediaSize(response.status, name => response.headers.get(name) || '');
    return {url: response.url, httpStatus: response.status, contentType, kind, mediaVerified: true, mediaCheckedAt: Date.now(), size, sizeVerified: size > 0, sizeCheckedAt: Date.now()};
  } catch (error) {
    error.mediaResponse = responseInfo;
    throw error;
  } finally { if (!response.body?.locked) await response.body?.cancel(); }
}

export function fileName(title, quality, contentType = 'video/mp4') {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+/g, '_').trim().slice(0, 90) || '视频';
  const extension = contentType.includes('webm') ? 'webm' : contentType.includes('quicktime') ? 'mov' : 'mp4';
  return `${safe}_${quality}.${extension}`;
}

