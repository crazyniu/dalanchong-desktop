/**
 * AI module map
 * Purpose: isolated-world bridge for the manifest's commerce pages and frames.
 * Entry: page message events from xhr.js and runtime messages from commerce-background.js.
 * Flow: forward tab/download requests to Chrome, return download acknowledgements
 * to the page, and expose the existing downloaded-video storage diagnostics.
 * State: downloadedVideos belongs to chrome.storage.local; this bridge owns no cache.
 * Boundary: preserve message types and payloads across the page/extension realms;
 * a successful download response acknowledges task creation, not file completion.
 */

window.addEventListener('message', (event) => {
  const message = event.data
  if (!message) return

  if (message.type === 'OPEN_TAB') {
    chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: message.url })
  } else if (message.type === 'PRINT_VIDEO_LIST') {
    chrome.storage.local.get('downloadedVideos', (result) => {
      console.log('本地存储的downloadedVideos:', result.downloadedVideos)
    })
  } else if (message.type === 'CLEAR_STORAGE') {
    chrome.storage.local.set({ downloadedVideos: [] }, () => {
      console.log('本地存储已清空')
    })
  } else if (message.type === 'DOWNLOAD_FILE_REQUEST') {
    console.log(
      'Content script收到下载请求: ' + message.filename + ' 到文件夹: '
        + message.folderName + ' (第 ' + (message.attempt || 1) + ' 次尝试)'
    )
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: message.url,
      filename: message.filename,
      folderName: message.folderName,
      attempt: message.attempt || 1,
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.error('Chrome连接错误:', chrome.runtime.lastError)
        window.postMessage({
          type: 'DOWNLOAD_FILE_RESPONSE',
          success: false,
          error: 'Chrome连接错误: ' + chrome.runtime.lastError.message,
          filename: message.filename,
        }, '*')
        return
      }

      window.postMessage({
        type: 'DOWNLOAD_FILE_RESPONSE',
        success: !!response && response.success,
        error: response ? response.error : 'No response',
        filename: message.filename,
      }, '*')
    })
  }
})

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'VIDEO_OPENED_TO_CONTENT') {
    window.postMessage({ type: 'VIDEO_OPENED_TO_FINAL', url: message.url }, '*')
  }
})
