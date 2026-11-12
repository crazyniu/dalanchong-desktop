/**
 * AI module map
 * Purpose: attach shop labels to existing web tabs when the extension worker starts.
 * Entry: background.js imports this module; scripting injects shop-label.js in the top frame.
 * Invariants: manifest scripts cover later navigations; the label guards duplicate injection.
 * Side effects: query web tabs and attach presentation-only isolated content scripts.
 */
chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).then(tabs => {
  for (const tab of tabs) {
    // A tab may close or deny injection while the other tabs remain eligible.
    void chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['shop-label.js'],
    }).catch(() => {});
  }
});
