/**
 * AI module map
 * Purpose: render one saved video in the extension-origin webpage preview frame.
 * Entry: preview.html passes media ID, nonce and parent origin in its query string.
 * Flow: storage supplies the verified complete video; embedded player rendering sends
 * a ready acknowledgement. Explicit close tells the injecting parent to remove the frame.
 * Boundary: no arbitrary media URL or parent command is accepted; no focus is requested.
 */
import './vendor/ui/components.js';
import {createPlayer} from './player.js';

const params = new URL(location.href).searchParams;
const notify = (type, details = {}) => parent.postMessage({
  type, previewId: params.get('preview'), ...details
}, params.get('parent'));
const player = createPlayer({embedded: true,
  onClose: () => notify('DALANCHONG_CLOSE_PREVIEW')});

try {
  const key = `media:${params.get('media')}`;
  const stored = await chrome.storage.session.get(key);
  const item = stored[key];
  if (!item?.mediaVerified || item.kind !== 'video') throw new Error('视频记录已清除，请刷新列表。');
  await player.open(item);
  requestAnimationFrame(() => notify('DALANCHONG_PREVIEW_READY', {ok: true}));
} catch (error) {
  notify('DALANCHONG_PREVIEW_READY', {ok: false, error: error.message});
}
