/**
 * AI module map
 * Purpose: display the managed shop name on top-level web pages.
 * Entry: manifest navigation scripts and shop-label-background.js inject this isolated script.
 * State: the desktop launcher owns local storage's shopIdentity; changes update the label.
 * Drag position belongs to this document and resets on navigation; viewport bounds keep it reachable.
 * Side effects: one fixed shadow host; pointer events are captured only on the label. No network access.
 */
(() => {
  if (globalThis.__dalanchongShopLabelLoaded) return;
  globalThis.__dalanchongShopLabelLoaded = true;
  const hostId = 'dalanchong-shop-label';
  document.getElementById(hostId)?.remove();
  const host = document.createElement('div');
  host.id = hostId;
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial !important;
      position: fixed !important;
      left: var(--shop-label-left, 16px) !important;
      top: var(--shop-label-top, auto) !important;
      bottom: var(--shop-label-bottom, 16px) !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      max-width: calc(100vw - 32px) !important;
    }
    span {
      display: block;
      box-sizing: border-box;
      padding: 8px 12px;
      border: 1px solid rgba(255, 255, 255, .16);
      border-radius: 8px;
      background: #a3b881;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0, 0, 0, .16);
      font: 500 14px/20px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow-wrap: anywhere;
      pointer-events: auto;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    span.dragging { cursor: grabbing; }
  `;
  const label = document.createElement('span');
  root.append(style, label);
  let drag;
  let position;

  function move(left, top) {
    const bounds = host.getBoundingClientRect();
    position = {
      left: Math.max(8, Math.min(left, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(top, window.innerHeight - bounds.height - 8)),
    };
    host.style.setProperty('--shop-label-left', `${position.left}px`);
    host.style.setProperty('--shop-label-top', `${position.top}px`);
    host.style.setProperty('--shop-label-bottom', 'auto');
  }

  label.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = host.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    label.setPointerCapture(event.pointerId);
    label.classList.add('dragging');
  });
  label.addEventListener('pointermove', event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    move(event.clientX - drag.x, event.clientY - drag.y);
  });
  const finishDrag = event => {
    if (!drag || drag.id !== event.pointerId) return;
    event.stopPropagation();
    drag = undefined;
    label.classList.remove('dragging');
    if (label.hasPointerCapture(event.pointerId)) label.releasePointerCapture(event.pointerId);
  };
  label.addEventListener('pointerup', finishDrag);
  label.addEventListener('pointercancel', finishDrag);
  label.addEventListener('lostpointercapture', finishDrag);
  label.addEventListener('click', event => event.stopPropagation());
  window.addEventListener('resize', () => {
    if (position && host.isConnected) move(position.left, position.top);
  });

  function render(identity) {
    if (!identity) {
      host.remove();
      return;
    }
    label.textContent = identity.name;
    document.documentElement.append(host);
    if (position) move(position.left, position.top);
  }

  chrome.storage.local.get('shopIdentity').then(({ shopIdentity }) => render(shopIdentity));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.shopIdentity) render(changes.shopIdentity.newValue);
  });
})();
