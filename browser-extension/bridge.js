/**
 * AI module map
 * Purpose: isolated-world transport from supported commerce-page capture to the extension service worker.
 * Entry: manifest content script on supported commerce frames; capture.js posts professional-video-capture messages.
 * Flow: accepts messages from this window and forwards their media item and explicit-refresh flag as CAPTURE_MEDIA through chrome.runtime.
 * State: a window marker prevents duplicate listeners within the frame; library.js owns persistence and downloads.
 * Boundary: this bridge forwards records; it does not parse page APIs or own the download queue.
 */
(() => {
if (window.__professionalVideoBridge) return;
window.__professionalVideoBridge = true;
window.addEventListener('message', event => {
  if (event.source !== window || event.data?.source !== 'professional-video-capture') return;
  chrome.runtime.sendMessage({type: 'CAPTURE_MEDIA', item: event.data.item, refresh: event.data.refresh === true}).catch(() => {});
});
})();
