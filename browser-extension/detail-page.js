/**
 * AI module map
 * Purpose: MAIN-world Kuaishou work-format and current-player source reader.
 * Entry: manifest.json exposes __dalanchongDetail.read to background.js script execution.
 * Flow: observed site JSON and bootstrap objects populate a bounded work cache; requested quality selects a current-work video address.
 * State: the document owns its most recent 30 work objects; fetch/XHR wrappers preserve original site responses.
 * Boundary: no extension APIs, storage or downloads here; ambiguous current formats fail instead of changing quality.
 */
(() => {
  if (window.__dalanchongDetail) return;
  const photos = new Map();
  function collect(value) {
    if (!value || typeof value !== 'object') return;
    if ((value.photoId || value.id) && (value.videoResource || value.manifest)) {
      photos.set(String(value.photoId || value.id), value);
      if (photos.size > 30) photos.delete(photos.keys().next().value);
    }
    Object.values(value).forEach(collect);
  }
  if (location.hostname === 'www.kuaishou.com') {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      if (response.ok && new URL(response.url).hostname === location.hostname && response.headers.get('content-type')?.includes('json')) {
        response.clone().json().then(collect).catch(() => {});
      }
      return response;
    };
    const open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      if (new URL(url, location.href).hostname === location.hostname) this.addEventListener('load', () => {
        try { collect(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch { /* Non-JSON page responses. */ }
      }, {once: true});
      return open.call(this, method, url, ...args);
    };
  }
  window.__dalanchongDetail = {
    read(quality) {
      const video = [...document.querySelectorAll('video')].filter(v => {
        const rect = v.getBoundingClientRect();
        return rect.width > 100 && rect.height > 100 && rect.bottom > 0 && rect.top < innerHeight &&
          rect.right > 0 && rect.left < innerWidth;
      }).sort((a, b) => Number(a.paused) - Number(b.paused) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
      if (!video) throw new Error('请先播放当前视频。');
      const current = video.currentSrc || video.src;
      const id = location.pathname.match(/^\/short-video\/([^/]+)/)?.[1];
      if (location.hostname === 'www.kuaishou.com') {
        collect(window.__APOLLO_STATE__);
        collect(window.__INITIAL_STATE__);
        const photo = photos.get(id);
        const resource = photo?.videoResource?.json || photo?.videoResource;
        const manifest = photo?.manifest?.json || photo?.manifest;
        const formats = [...(manifest?.adaptationSet || []), ...(resource?.h264?.adaptationSet || []), ...(resource?.hevc?.adaptationSet || [])].flatMap(set => set.representation || []);
        if (quality === 'original') {
          const original = formats.filter(format => format.url).sort((a, b) => {
            const marked = format => Number(/original|origin|原画/i.test(`${format.qualityType || ''} ${format.qualityLabel || ''}`));
            return marked(b) - marked(a) || (Number(b.width) * Number(b.height)) - (Number(a.width) * Number(a.height)) || Number(b.avgBitrate || b.maxBitrate || 0) - Number(a.avgBitrate || a.maxBitrate || 0);
          })[0];
          if (!original?.url) throw new Error('当前视频未返回可下载的画质地址。');
          return {url: original.url, title: photo.caption || id};
        }
        if (!/^https?:/.test(current)) {
          const matches = formats.filter(format => format.url && Number(format.width) === video.videoWidth && Number(format.height) === video.videoHeight);
          const urls = [...new Set(matches.map(format => format.url))];
          if (urls.length !== 1) throw new Error('当前清晰度地址尚未确定，请切换清晰度后再下载。');
          return {url: urls[0], title: photo.caption || id};
        }
      }
      if (!/^https?:/.test(current)) throw new Error('当前播放器未提供可直接下载的地址。');
      return {url: current, title: document.title};
    }
  };
})();
