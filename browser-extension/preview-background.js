/**
 * AI module map
 * Purpose: open popup-selected videos in the current webpage's center.
 * Entry: PREVIEW_MEDIA from popup.html supplies a verified session media ID and tab ID.
 * Flow: an isolated top-layer host embeds preview.html; its ready reply acknowledges
 * the rendered player before the popup request succeeds. CDN URLs stay in storage.
 * Ownership: each webpage owns one host, frame, readiness timeout and close listener.
 * Boundary: accept only this extension's popup; validate frame origin, source and nonce.
 * The manual popover and embedded player never request focus or close the popup.
 */
import {listenMessages} from './messages.js';

async function previewMedia(mediaId, tabId) {
  const stored = await chrome.storage.session.get(`media:${mediaId}`);
  const item = stored[`media:${mediaId}`];
  if (!item?.mediaVerified || item.kind !== 'video') throw new Error('视频记录已清除，请刷新列表。');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url)) throw new Error('请在普通网页中打开视频预览。');
  const url = new URL(chrome.runtime.getURL('preview.html'));
  const previewId = crypto.randomUUID();
  url.searchParams.set('media', mediaId);
  url.searchParams.set('preview', previewId);
  url.searchParams.set('parent', new URL(tab.url).origin);
  const [injection] = await chrome.scripting.executeScript({
    target: {tabId},
    func: (frameURL, previewId, origin) => new Promise(resolve => {
      globalThis.__dalanchongVideoPreview?.close();
      const host = document.createElement('div');
      host.popover = 'manual';
      host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden';
      const shadow = host.attachShadow({mode: 'closed'});
      const frame = document.createElement('iframe');
      frame.title = '视频预览';
      frame.src = frameURL;
      frame.allow = 'autoplay; fullscreen';
      frame.allowFullscreen = true;
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
      let pending = true;
      const finish = result => {
        if (!pending) return;
        pending = false;
        clearTimeout(timer);
        resolve(result);
      };
      const close = () => {
        finish({ok: false, error: '预览已关闭。'});
        window.removeEventListener('message', receive);
        window.removeEventListener('pagehide', close);
        host.remove();
        delete globalThis.__dalanchongVideoPreview;
      };
      const receive = event => {
        if (event.source !== frame.contentWindow || event.origin !== origin ||
            event.data?.previewId !== previewId) return;
        if (event.data.type === 'DALANCHONG_CLOSE_PREVIEW') close();
        if (event.data.type === 'DALANCHONG_PREVIEW_READY') {
          finish({ok: event.data.ok === true, error: event.data.error});
          if (!event.data.ok) close();
        }
      };
      const timer = setTimeout(() => {
        finish({ok: false, error: '预览未能打开，请刷新当前网页后重试。'});
        close();
      }, 10000);
      window.addEventListener('message', receive);
      window.addEventListener('pagehide', close, {once: true});
      shadow.append(frame);
      document.documentElement.append(host);
      globalThis.__dalanchongVideoPreview = {close};
      // A manual popover enters the top layer without dialog focusing steps.
      host.showPopover();
    }),
    args: [url.href, previewId, chrome.runtime.getURL('').slice(0, -1)],
  });
  if (injection?.result?.ok !== true) throw new Error(injection?.result?.error || '预览未能打开，请刷新当前网页后重试。');
}

listenMessages(new Set(['PREVIEW_MEDIA']), (message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) {
    respond({error: '此页面无权打开视频预览。'});
    return;
  }
  previewMedia(message.mediaId, message.tabId).then(() => respond({ok: true}),
    error => respond({error: error.message}));
});
