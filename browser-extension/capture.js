/**
 * AI module map
 * Purpose: MAIN-world video candidate discovery on supported commerce pages.
 * Entry: manifest injection; a window marker reuses the installed scanner.
 * Flow: DOM players and performance entries become professional-video-capture window messages for bridge.js.
 * State: document-local signatures deduplicate records and reset when the source location changes; observers batch only changed player subtrees.
 * Invariants: candidates require background verification before display; ordinary MediaSource buffers are not downloadable file records.
 * Side effects: observes DOM, performance, and playback events; no chrome APIs are available here.
 */
(() => {
  if (window.__professionalVideoCapture) {
    window.__professionalVideoCapture.scan(true);
    return;
  }
  const known = new Map();
  const pendingRoots = new Set();
  let pageURL = location.href;
  let scanTimer;
  let refreshCapture = false;
  const captureSelector = 'video, source[src]';
  const mediaPath = /\.(mp4|webm|mov|m4v|ogv|m3u8)(?:$|[?#])/i;
  const publish = (url, title = document.title, extra = {}) => {
    if (!url || !/^https?:/.test(url)) return;
    if (location.href !== pageURL) {
      pageURL = location.href;
      known.clear();
    }
    const kind = extra.kind || (/mpegurl/i.test(extra.contentType || '') || /\.m3u8(?:$|[?#])/i.test(url) ? 'hls' : 'video');
    const item = {url, title, sourceUrl: location.href, ...extra, kind};
    const previous = known.get(url);
    // Repeated player scans need not publish an unchanged URL again.
    if (previous && extra.quality === '网页视频') return;
    const signature = JSON.stringify(item);
    if (previous === signature) return;
    known.set(url, signature);
    window.postMessage({source: 'professional-video-capture', item, refresh: refreshCapture}, '*');
  };
  function publishResource(entry) {
    if (mediaPath.test(entry.name)) publish(entry.name, document.title, {quality: '网页视频'});
  }
  function publishSource(url, contentType = '') {
    // MediaSource blobs are player buffers; use network media files or HLS playlists as download sources.
    if (url.startsWith('blob:')) return;
    if (/\.(ts|m4s|vtt)(?:$|[?#])/i.test(url) || /mp2t|dash\+xml/i.test(contentType)) return;
    publish(url, document.title, {...(contentType ? {contentType} : {}), quality: '网页视频'});
  }
  function scanElement(node) {
    if (node.localName === 'video') publishSource(node.currentSrc || node.src);
    else if (node.localName === 'source' && node.parentElement?.localName === 'video') publishSource(node.src, node.type);
  }
  function scanRoot(root, force = false) {
    if (!root.isConnected) return;
    if (root.nodeType === 1 && root.matches(captureSelector)) scanElement(root, force);
    for (const node of root.querySelectorAll(captureSelector)) scanElement(node, force);
  }
  function scan(force = false) {
    // Explicit analysis must report fresh observations even when media metadata is unchanged.
    refreshCapture = force;
    try {
      if (force) {
        known.clear();
        for (const entry of performance.getEntriesByType('resource')) publishResource(entry);
      }
      scanRoot(document, force);
    } finally {
      refreshCapture = false;
    }
  }
  const scheduleScan = root => {
    pendingRoots.add(root);
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = undefined;
      // A document or parent scan already includes its queued descendants.
      for (const root of pendingRoots) {
        let parent = root.parentNode;
        while (parent && !pendingRoots.has(parent)) parent = parent.parentNode;
        if (!parent) scanRoot(root);
      }
      pendingRoots.clear();
    }, 150);
  };
  // Observe lazy loading, episode changes, and source updates without polling every page's players.
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target.matches('video, source')) scheduleScan(record.target);
      } else {
        if (record.target.nodeType === 1 && record.target.matches(captureSelector)) scheduleScan(record.target);
        for (const node of record.addedNodes) if (node.nodeType === 1) scheduleScan(node);
      }
    }
  }).observe(document, {childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'type']});
  new PerformanceObserver(list => {
    for (const entry of list.getEntries()) publishResource(entry);
  }).observe({type: 'resource', buffered: true});
  const scanPlayer = event => { if (event.target.localName === 'video') scheduleScan(event.target); };
  document.addEventListener('loadedmetadata', scanPlayer, true);
  document.addEventListener('play', scanPlayer, true);
  window.addEventListener('popstate', () => scheduleScan(document));
  window.__professionalVideoCapture = {scan};
  if (document.readyState !== 'loading') scan();
  else document.addEventListener('DOMContentLoaded', () => scan(), {once: true});
})();
