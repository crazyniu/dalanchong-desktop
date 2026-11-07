/**
 * AI module map
 * Purpose: MAIN-world Douyin detail reader and original-file probe helper.
 * Entry: manifest injection exposes window.__douyinOriginal to background.js injected calls.
 * Flow: bootstrap data, React Flight records, and observed work API responses populate a bounded detail cache; normalized formats and probe requests support platform analysis.
 * State: the cache keeps only download fields for the latest 100 works; probe resources belong to the current document and the background observes cross-origin redirect addresses.
 * Invariants: keep the site's own fetch/XHR responses and SDK call chain intact; select formats using the existing resolution, bitrate, and address ordering.
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
      // Retain only the fields consumed by getDetail and selectHD below.
      videos.set(key, {
        title: value.desc, author: value.author?.nickname,
        imagePost: Boolean(value.images?.length || value.imageInfos?.length),
        videoId: address?.uri, needCookie: Boolean(video.is_need_set_cookie),
        width: video.width || address?.width || 0, height: video.height || address?.height || 0,
        rates: (video.bit_rate || video.bitRateList || []).map(rate => {
          const play = rate.play_addr || rate.playAddr;
          return {format: rate.format, gear_name: rate.gear_name, bit_rate: rate.bit_rate,
            play_addr: play && {url_list: play.url_list, data_size: play.data_size || play.dataSize,
              width: play.width, height: play.height}};
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
        if (xhr.status !== 200) {
          reject(new Error(`详情接口返回 HTTP ${xhr.status}，请在抖音页面完成验证后重试。`));
          return;
        }
        try {
          const data = JSON.parse(xhr.responseText);
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
    const uri = item.videoId;
    if (!uri) throw new Error("详情中没有视频内部 ID，无法探测原片。 ");
    const rates = item.rates;
    return {
      awemeId: id, videoId: uri, title: item.title || id,
      author: item.author || "", needCookie: item.needCookie,
      transcodeSize: Math.max(0, ...rates.map(rate => Number(rate.play_addr?.data_size || 0))),
      hd: selectHD(rates),
      width: item.width, height: item.height
    };
  }

  // Preserve the supplied plugin's format ordering: MP4 resolution, then bitrate, then shortest URL within a tier.
  function selectHD(rates) {
    const candidates = rates.filter(rate => rate.format === "mp4" && rate.play_addr?.url_list?.length)
      .map(rate => {
        const address = rate.play_addr;
        const gear = rate.gear_name || "";
        const resolution = [1440, 1080, 720, 540, 480, 360].find(value => gear.includes(String(value)))
          || (gear.includes("4_") ? 2160 : Number(gear.match(/(\d{3,4})/)?.[1]) || Math.min(address.width || 0, address.height || 0));
        return {url: address.url_list.slice().sort((a, b) => a.length - b.length)[0], resolution, bitRate: rate.bit_rate || 0};
      }).sort((a, b) => b.resolution - a.resolution || b.bitRate - a.bitRate);
    return candidates[0] || null;
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
    probe.setRequestHeader("Range", "bytes=0-0");
    probe.send();
  }

  window.__douyinOriginal = {getDetail, startProbe, stopProbe: () => probe?.abort()};
})();
