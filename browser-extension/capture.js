/**
 * AI module map
 * Report actual webpage video playback from the isolated content-script world.
 * CAPTURE_MEDIA carries the HTTP(S) currentSrc, dimensions and readyState only after
 * a video has played and decoded a frame; the background saves that playback directly
 * and merges its dimensions with complete-video records observed in network responses.
 * Blob URLs, playlists and segments are not downloadable complete-video reports.
 * Observe document and discovered open shadow roots without patching browser APIs.
 * Runs in HTTP(S) documents and frames; the background owns the real top-level tab.
 * Only in-flight reports are coalesced here; the background owns successful
 * deduplication, including releasing it when the user clears the video list.
 */
(() => {
  if (globalThis.__dalanchongVideoCapture) return;
  globalThis.__dalanchongVideoCapture = true;
  const pending = new Set();
  const roots = new Set();
  const observedRoots = new WeakSet();
  let timer;
  const excludedPath = /\.(ts|m4s|m3u8|mpd|vtt|mp3|m4a|aac|wav|flac)(?:$|[?#])/i;

  function publishPlayer(video) {
    const {currentSrc, videoWidth, videoHeight, readyState} = video;
    if ((video.paused && video.played.length === 0) || readyState < 2 || videoWidth <= 0 || videoHeight <= 0 ||
        !/^https?:/.test(currentSrc) || excludedPath.test(currentSrc)) return;
    const key = `${location.href}:${currentSrc}`;
    if (pending.has(key)) return;
    pending.add(key);
    void chrome.runtime.sendMessage({type: 'CAPTURE_MEDIA', item: {
      url: currentSrc, title: document.title, sourceUrl: location.href,
      playback: {currentSrc, videoWidth, videoHeight, readyState}
    }}).then(() => pending.delete(key), () => pending.delete(key));
  }

  function scan(root) {
    if (!root.isConnected) return;
    if (root.localName === 'video') publishPlayer(root);
    for (const player of root.querySelectorAll('video')) publishPlayer(player);
    const elements = root.nodeType === 1 ? [root, ...root.querySelectorAll('*')] : root.querySelectorAll('*');
    for (const element of elements) {
      if (!element.shadowRoot) continue;
      observeRoot(element.shadowRoot);
      scan(element.shadowRoot);
    }
  }

  function schedule(root) {
    roots.add(root);
    if (timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      for (const node of roots) {
        let parent = node.parentNode;
        while (parent && !roots.has(parent)) parent = parent.parentNode;
        if (!parent) scan(node);
      }
      roots.clear();
    }, 150);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1) schedule(node);
    }
  });

  function observeRoot(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, {childList: true, subtree: true});
    // Media readiness events do not cross shadow boundaries, so each root listens.
    for (const name of ['loadeddata', 'playing']) {
      root.addEventListener(name, event => {
        if (event.target.localName === 'video') schedule(event.target);
      }, true);
    }
  }

  observeRoot(document);
  window.addEventListener('popstate', () => schedule(document));
  if (document.readyState !== 'loading') scan(document);
  else document.addEventListener('DOMContentLoaded', () => scan(document), {once: true});
})();
