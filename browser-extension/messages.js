/**
 * AI module map
 * Purpose: register extension-owned message handlers without claiming other routes.
 * Entry: background modules call listenMessages with their handled message types.
 * Flow: same-extension messages reach the matching handler synchronously; handlers
 * own their async work and responses while the listener keeps that response channel open.
 * Boundary: sender/type filtering remains in place; no desktop connection is required.
 */
export function listenMessages(types, handler) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !types.has(message.type)) return;
    try { handler(message, sender, respond); }
    catch (error) { respond({ok: false, success: false, error: error.message}); }
    return true;
  });
}
