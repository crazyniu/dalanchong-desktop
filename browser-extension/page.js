/**
 * AI module map
 * Purpose: MAIN-world Douyin detail reader and original-file probe helper.
 * Entry: manifest injection exposes window.__douyinOriginal to background.js injected calls.
 * Flow: bootstrap data, React Flight records, and observed work API responses populate a bounded detail cache; complete MP4 addresses also supply available-quality batch results, while the bound player's definition selects current-quality downloads.
 * State: the cache keeps only download fields for the latest 100 works; probe resources belong to the current document. Original probes revalidate platform scheduling, and the background observes cross-origin redirect addresses.
 * Invariants: keep the site's own fetch/XHR responses and SDK call chain intact; current-quality selection uses the active player gear and quality type.
 * Boundary: no chrome APIs or extension storage are available in this execution world.
 */
(() => {
  if (window.__douyinOriginal) return;

  const videos = new Map();
  let probe;

  function collect(value) {
    if (!value || typeof value !== "object") return;
    const id = value.aweme_id || value.awemeId;
    if (id && value.video) {
      const video = value.video;
      const address = video.play_addr || video.playAddr;
      const key = String(id);
      videos.delete(key);
      // API/bootstrap objects include unrelated author, recommendation and image data.
      // Retain only the fields consumed by original, batch and current-quality readers.
      videos.set(key, {
        title: value.desc, author: value.author?.nickname,
        imagePost: Boolean(value.images?.length || value.imageInfos?.length),
        videoId: address?.uri, needCookie: Boolean(video.is_need_set_cookie),
        width: video.width || address?.width || 0, height: video.height || address?.height || 0,
        play_addr: address && {url_list: address.url_list, width: address.width, height: address.height},
        rates: (video.bit_rate || video.bitRateList || []).map(rate => {
          const play = rate.play_addr || rate.playAddr;
          return {format: rate.format, gear_name: rate.gear_name, quality_type: rate.quality_type,
            bit_rate: rate.bit_rate,
            play_addr: play && {url_list: play.url_list, width: play.width, height: play.height}};
        })
      });
      if (videos.size > 100) videos.delete(videos.keys().next().value);
      return;
    }
    Object.values(value).forEach(collect);
  }

  function readBootstrap() {
    const render = document.getElementById("RENDER_DATA");
    if (render) collect(JSON.parse(decodeURIComponent(render.textContent)));
    if (window._ROUTER_DATA) collect(window._ROUTER_DATA);

    // Standalone video pages also store details in React Flight JSON records.
    for (const script of document.scripts) {
      const match = script.textContent.match(/^self\.__pace_f\.push\((\[1,"[\s\S]*"\])\);?$/);
      if (!match) continue;
      const text = JSON.parse(match[1])[1];
      for (const line of text.split("\n")) {
        const record = line.match(/^[\da-f]+:([\[{][\s\S]*)$/i);
        if (record) collect(JSON.parse(record[1]));
      }
    }
  }

  // Observe only Douyin work responses and preserve the site's requests, responses, and SDK call chain.
  const isVideoAPI = url => String(url).includes("/aweme/v1/web/aweme/");
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    if (isVideoAPI(response.url) && response.ok) {
      response.clone().json().then(collect).catch(() => {});
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...args) {
    if (isVideoAPI(url)) {
      this.addEventListener("load", () => {
        if (this.status !== 200) return;
        // Observation failures must not interrupt the site's player.
        try {
          collect(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
        } catch { /* The endpoint may return a verification HTML page instead of JSON. */ }
      }, {once: true});
    }
    return originalOpen.call(this, method, url, ...args);
  };

  function requestDetail(id) {
    const params = new URLSearchParams({
      device_platform: "webapp", aid: "6383", channel: "channel_pc_web", aweme_id: id,
      pc_client_type: "1", version_code: "190600", version_name: "19.6.0",
      cookie_enabled: "true", browser_language: navigator.language,
      browser_platform: navigator.platform, browser_name: "Chrome",
      browser_version: navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || "",
      screen_width: String(screen.width), screen_height: String(screen.height)
    });
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `/aweme/v1/web/aweme/detail/?${params}`);
      xhr.withCredentials = true;
      xhr.timeout = 12000;
      xhr.onload = () => {
        const diagnostic = {workId: id, endpoint: '/aweme/v1/web/aweme/detail/',
          httpStatus: xhr.status, contentType: xhr.getResponseHeader('content-type') || ''};
        console.info('[大懒虫视频] 详情接口响应', diagnostic);
        if (xhr.status !== 200) {
          reject(new Error(`详情接口返回 HTTP ${xhr.status}，请在抖音页面完成验证后重试。`));
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText);
          console.info('[大懒虫视频] 详情接口结果', {...diagnostic, statusCode: data.status_code,
            message: data.status_msg, hasDetail: Boolean(data.aweme_detail), hasVideo: Boolean(data.aweme_detail?.video)});
          if (data.status_code === 2483 || /请先登录|用户未登录/.test(data.status_msg || "")) {
            throw new Error("抖音要求登录，请先在当前页面登录。 ");
          }
          collect(data);
          resolve();
        } catch (error) {
          reject(new Error(`未能读取视频详情：${error.message}`));
        }
      };
      xhr.onerror = () => reject(new Error("详情请求失败，请确认当前页面能正常播放视频。"));
      xhr.ontimeout = () => reject(new Error("详情请求超时，请稍后重试。"));
      xhr.send();
    });
  }

  async function getDetail(id) {
    if (!videos.has(id)) readBootstrap();
    if (!videos.has(id)) await requestDetail(id);
    const item = videos.get(id);
    if (!item) throw new Error("抖音未返回这个作品的详情，请刷新视频页后重试。 ");
    if (item.imagePost) {
      throw new Error("当前作品是图文，本插件目前只处理普通视频。 ");
    }
    const formats = item.rates.filter(rate => rate.format === 'mp4').map(rate => ({
      address: rate.play_addr, bitrate: rate.bit_rate || 0
    }));
    formats.push({address: item.play_addr, bitrate: 0});
    return {
      awemeId: id, videoId: item.videoId, title: item.title || id,
      author: item.author || "", needCookie: item.needCookie,
      width: item.width, height: item.height,
      // DASH entries are excluded: batch alternatives must remain complete files.
      formats: formats.filter(format => format.address?.url_list?.length).map(({address, bitrate}) => {
        const width = address.width || 0, height = address.height || 0;
        const definition = Math.min(width, height);
        return {urls: address.url_list, width, height, bitrate,
          quality: definition ? `${definition}p` : '可用清晰度'};
      }).sort((a, b) => Math.min(b.width, b.height) - Math.min(a.width, a.height) || b.bitrate - a.bitrate)
    };
  }

  function startProbe(videoId, needCookie) {
    const params = new URLSearchParams({
      video_id: videoId, ratio: "default", line: "0", is_play_url: "1",
      watermark: "0", source: "PackSourceEnum_PUBLISH"
    });
    if (needCookie) params.set("ss_is_p_v_ss", "1");
    probe = new XMLHttpRequest();
    probe.open("GET", `/aweme/v1/play/?${params}`);
    probe.withCredentials = true;
    probe.timeout = 12000;
    // Re-resolving an unavailable CDN must reach the platform scheduler again.
    probe.setRequestHeader("Cache-Control", "no-cache");
    probe.setRequestHeader("Range", "bytes=0-0");
    probe.send();
  }

  function getCurrentIdentity() {
    const video = [...document.querySelectorAll('video')].filter(v => {
      const rect = v.getBoundingClientRect();
      return rect.width > 100 && rect.height > 100 && rect.bottom > 0 && rect.top < innerHeight &&
        rect.right > 0 && rect.left < innerWidth;
    }).sort((a, b) => Number(a.paused) - Number(b.paused) || b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
    if (!video) return null;
    // Only a player actually owning this video can identify its active quality.
    const definition = window.player?.video === video ? window.player.curDefinition : null;
    const params = new URLSearchParams(location.search);
    return {
      awemeId: params.get('modal_id') || params.get('vid') || location.pathname.match(/^\/video\/(\d+)/)?.[1],
      source: video.currentSrc || video.src,
      width: video.videoWidth, height: video.videoHeight,
      definitionId: definition?.vid == null ? null : String(definition.vid),
      gearName: definition?.gearName || '', qualityType: definition?.qualityType ?? null,
      vtype: definition?.vtype || ''
    };
  }

  async function getCurrent() {
    const identity = getCurrentIdentity();
    if (!identity) throw new Error('请先播放当前视频。');
    const id = identity.awemeId;
    const direct = /^https?:/.test(identity.source) && identity.vtype !== 'DASH';
    const identified = identity.definitionId === id && identity.gearName && identity.qualityType != null;
    if (!direct && !identified) {
      throw new Error('尚未识别当前播放档位，请播放视频后再下载。');
    }
    if (!videos.has(id)) {
      if (direct) {
        // Alternate CDNs are optional for an already playable complete address.
        try { await getDetail(id); }
        catch {
          return {url: identity.source, urls: [identity.source], title: document.title, currentIdentity: identity};
        }
      } else await getDetail(id);
    }
    const item = videos.get(id);
    // DASH definitions point to video-only tracks. The work API provides a complete
    // MP4 for that same gear and quality type; dimensions alone cannot distinguish gears.
    const formats = item.rates.filter(rate => rate.format === 'mp4' && rate.play_addr?.url_list?.length);
    let matches;
    if (identified) {
      matches = formats.filter(rate => rate.gear_name === identity.gearName &&
        Number(rate.quality_type) === Number(identity.qualityType));
    } else {
      // Known file paths survive CDN hosts and signatures; play API endpoints do
      // not identify a file by pathname alone. Keep quality selectors in the key.
      const mediaPath = value => {
        const url = new URL(value);
        const start = url.pathname.indexOf('/video/tos/');
        if (start < 0) return null;
        const quality = ['quality', 'ratio', 'format', 'watermark'].map(key => `${key}=${url.searchParams.get(key) || ''}`).join('&');
        return `${url.pathname.slice(start)}?${quality}`;
      };
      const currentPath = mediaPath(identity.source);
      if (item.play_addr?.url_list?.length) formats.push({play_addr: item.play_addr});
      const matched = formats.find(rate => rate.play_addr.url_list.some(url =>
        url === identity.source || (currentPath && mediaPath(url) === currentPath)));
      matches = matched ? [matched] : [];
    }
    const urls = [...new Set([...(direct ? [identity.source] : []),
      ...matches.flatMap(rate => rate.play_addr.url_list)].filter(url => /^https?:/.test(url)))];
    if (!urls.length) throw new Error('当前播放档位没有完整 MP4 地址，请切换清晰度后再下载。');
    return {url: direct ? identity.source : urls[0], urls, title: item.title || id, currentIdentity: identity};
  }

  // The isolated controls request a synchronous state snapshot for their existing
  // refresh timer. This DOM value schedules reads only; the worker resolves the
  // trusted source again through getCurrent before creating any download.
  document.addEventListener('dalanchong-read-current-quality', () => {
    const identity = getCurrentIdentity();
    document.documentElement.dataset.dalanchongCurrentQuality = identity ? JSON.stringify(identity) : '';
  });

  window.__douyinOriginal = {getDetail, getCurrent, getCurrentIdentity, startProbe, stopProbe: () => probe?.abort()};
})();
