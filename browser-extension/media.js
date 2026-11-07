/**
 * AI module map
 * Purpose: shared media URL/type helpers and ranged HTTP transfer and response-confirmed media classification.
 * Entry: library.js uses normalization, naming, and probing; offscreen.js calls fetchVideo.
 * Flow: range metadata determines total size, byteRanges divides transfers, and fetched chunks are joined into a Blob with progress callbacks.
 * Completed byte batches become Blob parts during streaming so a non-range download
 * does not retain the complete file as JavaScript typed arrays until completion.
 * Invariants: validate response ranges and lengths; reuse a full response when ranges are unsupported; the supplied AbortSignal cancels transfer work.
 * Boundary: this module does not own job persistence or Chrome's final save operation.
 */
import {mediaSize} from './media-records.js';
import {isMediaURL} from './platforms.js';

export const platformName = () => '抖音';

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
  if (/^(application|audio)\/(vnd\.apple\.mpegurl|x-mpegurl|mpegurl)$/.test(mime)) return 'hls';
  if (/^video\//.test(mime)) return 'video';
  if (/^audio\//.test(mime)) return 'audio';
  // A video-looking URL cannot override an image, HTML, JSON or other explicit type.
  if (mime && !['application/octet-stream', 'binary/octet-stream'].includes(mime)) return null;
  if (/\.m3u8$/i.test(path)) return 'hls';
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(path)) return 'video';
  if (isMediaURL(url) && (path.includes('/video/tos/') || parsed.searchParams.get('mime_type') === 'video_mp4')) return 'video';
  return null;
}

const mediaProbes = new Map();
export function probeMediaFile(url, {trustedVideo = false} = {}) {
  // DOM capture and both commerce caches can discover the same request together.
  const key = `${trustedVideo}:${url}`;
  if (!mediaProbes.has(key)) mediaProbes.set(key, inspectMediaFile(url, trustedVideo).finally(() => mediaProbes.delete(key)));
  return mediaProbes.get(key);
}

async function inspectMediaFile(url, trustedVideo) {
  const response = await fetch(url, {headers: {Range: 'bytes=0-511'}, credentials: 'include', signal: AbortSignal.timeout(15000)});
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
      // MP4/HLS containers can also hold audio. Opaque responses additionally
      // require a video field from the detail API or a known Douyin video path.
      if (videoSource && text.startsWith('#EXTM3U')) kind = 'hls';
      else if (videoSource && text.slice(4, 8) === 'ftyp' && !/^(avif|avis|heic|heix|hevc|hevx|mif1|msf1|M4A |M4B |M4P )$/.test(text.slice(8, 12))) kind = 'video';
      else throw new Error('地址未返回可确认的视频文件。');
    }
    if (kind === 'hls' && !videoSource) throw new Error('播放列表尚未确认包含视频。');
    if (!kind || kind === 'audio') throw new Error('地址未返回可下载视频。');
    const size = mediaSize(response.status, name => response.headers.get(name) || '', kind);
    return {url: response.url, contentType, kind, mediaVerified: true, mediaCheckedAt: Date.now(), size, sizeVerified: size > 0, sizeCheckedAt: Date.now()};
  } finally { if (!response.body?.locked) await response.body?.cancel(); }
}

export function fileName(title, quality, contentType = 'video/mp4') {
  const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\.+/g, '_').trim().slice(0, 90) || '视频';
  const extension = contentType.includes('webm') ? 'webm' : contentType.includes('quicktime') ? 'mov' : 'mp4';
  return `${safe}_${quality}.${extension}`;
}

export function byteRanges(size, chunkSize = 4 * 1024 * 1024) {
  return Array.from({length: Math.ceil(size / chunkSize)}, (_, index) => ({
    start: index * chunkSize, end: Math.min(size - 1, (index + 1) * chunkSize - 1)
  }));
}

export async function fetchVideo(url, {threads, signal, onProgress}) {
  const read = async (start, end) => {
    return fetch(url, {headers: {Range: `bytes=${start}-${end}`}, credentials: 'include', signal});
  };
  const probe = await read(0, 0);
  const contentType = probe.headers.get('content-type') || 'video/mp4';
  if (/text\/html|application\/json/i.test(contentType)) {
    await probe.body?.cancel();
    throw new Error('视频地址返回了验证页面，请回到作品页重新识别。');
  }
  const total = Number(probe.headers.get('content-range')?.match(/\/(\d+)$/)?.[1] || 0);
  const ranged = probe.status === 206;
  if (!probe.ok) {
    await probe.body?.cancel();
    throw new Error(`视频地址返回 HTTP ${probe.status}，请回到作品页重新识别。`);
  }
  let received = 0;
  const readBody = async (response, size) => {
    const reader = response.body.getReader();
    const pieces = [];
    const parts = [];
    let length = 0, buffered = 0;
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      pieces.push(value); buffered += value.byteLength;
      length += value.byteLength; received += value.byteLength;
      // Release completed byte batches while long non-range responses keep arriving.
      if (buffered >= 4 * 1024 ** 2) {
        parts.push(new Blob(pieces));
        pieces.length = 0;
        buffered = 0;
      }
      onProgress(received, size);
    }
    if (pieces.length) parts.push(new Blob(pieces));
    return {blob: new Blob(parts, {type: contentType}), length};
  };
  if (!ranged) {
    // Reuse this response when the server does not support ranges instead of canceling and downloading again.
    const response = probe.status === 200 ? probe : await fetch(url, {credentials: 'include', signal});
    if (!response.ok) throw new Error(`下载返回 HTTP ${response.status}`);
    return (await readBody(response, Number(response.headers.get('content-length')) || 0)).blob;
  }
  await probe.body?.cancel();
  // Reduce fragment requests for large files while retaining enough ranges to keep workers occupied.
  const chunkSize = Math.max(4 * 1024 ** 2, Math.min(32 * 1024 ** 2, Math.ceil(total / (threads * 4))));
  const ranges = byteRanges(total, chunkSize);
  const chunks = new Array(ranges.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(threads, ranges.length)}, async () => {
    while (next < ranges.length) {
      const index = next++;
      const {start, end} = ranges[index];
      const response = await read(start, end);
      const range = response.headers.get('content-range');
      if (response.status !== 206 || (range && range !== `bytes ${start}-${end}/${total}`) || !response.ok) {
        throw new Error('服务器返回的分段范围不一致，已停止合并，请重新识别视频。');
      }
      const part = await readBody(response, total);
      if (part.length !== end - start + 1) throw new Error('视频分段不完整，请重新下载。');
      chunks[index] = part.blob;
    }
  }));
  return new Blob(chunks, {type: contentType});
}
