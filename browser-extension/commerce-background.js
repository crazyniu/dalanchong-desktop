/**
 * AI module map
 * Purpose: service-worker support for commerce-page downloads, media caches, and floating download panels.
 * Entry: imported by background.js; registers commerce runtime, network, tab, and Chrome download listeners.
 * Flow: content-script requests use Chrome downloads or page fetches; observed Douyin parameters and tab media records feed the existing commerce workflow.
 * State: this module owns its commerce caches and chrome.storage.local persistence separately from library.js session records and native download jobs.
 * Media cache startup is shared by readers and tab cleanup; writes coalesce bursts and passive duplicate responses leave records unchanged.
 * Boundary: keep page-message protocols and download/cache behavior intact; media-records.js limits capture to Douyin and its commerce pages.
 * Side effects: browser downloads, tab messages, platform requests, and local extension storage.
 */
import { canCaptureCommerceSource as canCaptureSource, mediaSize } from './media-records.js'
import { videoPage } from './platforms.js'
import { mediaType, probeMediaFile } from './media.js'
import { listenMessages } from './messages.js'

async function downloadFile(url, filename, folderName) {
  try {
    console.log('开始下载文件: ' + filename + ' 到文件夹: ' + folderName)
    console.log('下载URL: ' + url)
    if (!url || !url.startsWith('http')) throw new Error('无效的下载URL: ' + url)
    const media = await probeMediaFile(url, {
      trustedVideo: true,
    })
    if (media.kind !== 'video') throw new Error('该地址不是可直接保存的视频文件。')
    const downloadOptions = {
      url: media.url,
      filename: folderName + '/' + filename,
      saveAs: false,
      conflictAction: 'uniquify',
    }
    const downloadId = await chrome.downloads.download(downloadOptions)
    console.log('文件下载任务已创建，下载ID: ' + downloadId)
    return downloadId
  } catch (error) {
    console.error('下载文件失败:', error)
    throw error
  }
}
const DOUYIN_PARAM_CACHE = []
const DOUYIN_PARAM_IGNORED_KEYS = new Set(['a_bogus', 'fp', 'verifyFp', 'msToken'])
const DOUYIN_DETAIL_PATTERN = 'https://*.douyin.com/aweme/v1/web/*'
const DOUYIN_PARAM_CACHE_STORAGE_KEY = 'param_cache'
const DOUYIN_MESSAGE_TYPES = {
  DOWNLOAD_VIDEO_REQ: 'DOWNLOAD_VIDEO_REQ',
  DOWNLOAD_VIDEO_RESP: 'DOWNLOAD_VIDEO_RESP',
  DOWNLOAD_STATUS: 'DOWNLOAD_STATUS',
  ERROR_FIND_VID_REQ: 'ERROR_FIND_VID_REQ',
  FETCH_AWEME_DETAIL_REQ: 'FETCH_AWEME_DETAIL_REQ',
}
const DOUYIN_SNACKBAR_TEXT = {
  parseInformation: '正在解析信息',
  parseInformationFail: '解析视频信息失败，请刷新页面并重试',
  startDownload: '开始下载',
  completeDownload: '下载完成',
  downloadFailed: '下载失败，请刷新页面重试',
}
const GENERIC_VIDEO_MESSAGE_TYPES = {
  LIST_REQ: 'GENERIC_VIDEO_LIST_REQ',
  CLEAR_REQ: 'GENERIC_VIDEO_CLEAR_REQ',
  DOWNLOAD_ITEM_REQ: 'GENERIC_VIDEO_DOWNLOAD_ITEM_REQ',
}
const GENERIC_MEDIA_BY_TAB_ID = new Map()
const GENERIC_MEDIA_STORAGE_KEY = 'generic_medias'
const GENERIC_MEDIA_MAX_ITEMS = 80
let isDouyinParamCacheRestored = false
let genericMediaRestore

async function saveDouyinParamCache() {
  try {
    await chrome.storage.local.set({
      [DOUYIN_PARAM_CACHE_STORAGE_KEY]: DOUYIN_PARAM_CACHE.slice(0, 10),
    })
  } catch (error) {}
}

async function restoreDouyinParamCache() {
  if (isDouyinParamCacheRestored) return
  isDouyinParamCacheRestored = true
  try {
    const stored = await chrome.storage.local.get([DOUYIN_PARAM_CACHE_STORAGE_KEY])
    const entries = stored[DOUYIN_PARAM_CACHE_STORAGE_KEY]
    if (!Array.isArray(entries)) return
    entries.forEach((entry) => {
      if (!entry || typeof entry.time !== 'number' || !Array.isArray(entry.params)) return
      if (!DOUYIN_PARAM_CACHE.some((cached) => cached.time === entry.time)) {
        DOUYIN_PARAM_CACHE.push(entry)
      }
    })
    DOUYIN_PARAM_CACHE.sort((left, right) => right.time - left.time)
    if (DOUYIN_PARAM_CACHE.length > 100) {
      DOUYIN_PARAM_CACHE.splice(100)
    }
  } catch (error) {}
}

function rememberDouyinDetailParams(details) {
  if (!details || !details.url || details.url.includes('chrome-extension://')) return
  if (details.initiator && details.initiator.includes('extension://')) return
  let params
  try {
    params = Array.from(new URL(details.url).searchParams.entries())
  } catch (error) {
    return
  }
  if (params.length < 35) return
  DOUYIN_PARAM_CACHE.unshift({
    time: Date.now(),
    params,
  })
  if (DOUYIN_PARAM_CACHE.length > 100) {
    DOUYIN_PARAM_CACHE.splice(100)
  }
  saveDouyinParamCache()
}

function sanitizeDownloadName(name) {
  return String(name || '')
    .replace(/[<>:"/\\|?*\n]+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF\u200C\u2028\u2029\u200E\u200F\u000B]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function ensureFilenameExtension(filename, extension) {
  const safeName = sanitizeDownloadName(filename) || 'video'
  const safeExtension = sanitizeDownloadName(extension || 'mp4').replace(/^\.+/, '') || 'mp4'
  if (new RegExp('\\.' + safeExtension + '$', 'i').test(safeName)) return safeName
  return safeName.replace(/\.[a-z0-9]{2,5}$/i, '') + '.' + safeExtension
}

function buildDouyinDetailUrl(awemeId, params) {
  const url = new URL('https://www.douyin.com/aweme/v1/web/aweme/detail/')
  params.forEach(([key, value]) => {
    if (key === 'aweme_id') {
      url.searchParams.append('aweme_id', awemeId)
    } else {
      url.searchParams.append(key, value)
    }
  })
  if (!url.searchParams.has('aweme_id')) {
    url.searchParams.append('aweme_id', awemeId)
  }
  return url.toString()
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function waitForDouyinParams(milliseconds) {
  return DOUYIN_PARAM_CACHE.length > 0 ? Promise.resolve() : delay(milliseconds)
}

function buildDouyinRefreshUrl(awemeId, params) {
  return buildDouyinDetailUrl(
    awemeId,
    params.filter(([key]) => !DOUYIN_PARAM_IGNORED_KEYS.has(key)),
  )
}

async function requestDouyinPageFetch(url, requestedTabId) {
  try {
    let tabId = requestedTabId
    if (!tabId) {
      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      })
      if (!tabs.length || !tabs[0].id) return
      tabId = tabs[0].id
    }
    await chrome.tabs.sendMessage(tabId, {
      type: DOUYIN_MESSAGE_TYPES.FETCH_AWEME_DETAIL_REQ,
      data: {
        url,
      },
    })
  } catch (error) {
    chrome.runtime.lastError
  }
}

async function fetchDouyinAwemeDetail(awemeId, tabId) {
  await restoreDouyinParamCache()
  await waitForDouyinParams(300)
  for (let attempt = 0; attempt < 10; attempt++) {
    const cachedParams = DOUYIN_PARAM_CACHE.slice().sort((left, right) => right.time - left.time)[0]
    if (!cachedParams) {
      await waitForDouyinParams(200)
      continue
    }
    const url = buildDouyinDetailUrl(awemeId, cachedParams.params)
    try {
      const response = await fetch(url, {
        credentials: 'include',
      })
      if (!response.ok) throw new Error('Douyin detail request failed: ' + response.status)
      const body = await response.text()
      if (!body) throw new Error('Douyin detail response is empty')
      const detail = JSON.parse(body)
      if (detail && detail.aweme_detail) return detail.aweme_detail
    } catch (error) {}
    DOUYIN_PARAM_CACHE.shift()
    saveDouyinParamCache()
    await requestDouyinPageFetch(buildDouyinRefreshUrl(awemeId, cachedParams.params), tabId)
    await delay(200)
  }
  return null
}

async function sendDouyinDownloadStatus(requestedTabId, text, status, timeout) {
  try {
    let tabId = requestedTabId
    if (!tabId) {
      const tabs = await chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
      })
      if (!tabs.length || !tabs[0].id) return
      tabId = tabs[0].id
    }
    await chrome.tabs.sendMessage(tabId, {
      type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_STATUS,
      status,
      data: {
        text,
        timeout: timeout || 2000,
      },
    })
  } catch (error) {
    chrome.runtime.lastError
  }
}

function getDouyinResolutionNumber(gearName, fallbackResolution) {
  if (gearName.includes('1440')) return 1440
  if (gearName.includes('1080')) return 1080
  if (gearName.includes('720')) return 720
  if (gearName.includes('540')) return 540
  if (gearName.includes('480')) return 480
  if (gearName.includes('360')) return 360
  if (gearName.includes('4_')) return 2160
  let match = gearName.match(/(\d{3,4})_/)
  if (!match) {
    match = gearName.match(/(\d{3,4})/)
  }
  return match && match[1] ? parseInt(match[1], 10) : fallbackResolution
}

function getDouyinResolutionText(resolution) {
  if (resolution === 2160) return '4K'
  if (resolution === 1440) return '2K'
  return resolution + 'P'
}

function buildDouyinVideoDownloadInfo(aweme) {
  if (!aweme || !aweme.video || !Array.isArray(aweme.video.bit_rate)) return null
  const formats = aweme.video.bit_rate
    .filter(
      (format) =>
        format &&
        format.format === 'mp4' &&
        format.play_addr &&
        Array.isArray(format.play_addr.url_list) &&
        format.play_addr.url_list.length > 0,
    )
    .map((format) => {
      const shortSide = Math.min(format.play_addr.width || 0, format.play_addr.height || 0)
      const resolution = getDouyinResolutionNumber(format.gear_name || '', shortSide)
      return {
        bitRate: format.bit_rate || 0,
        dataSize: format.play_addr.data_size || 0,
        format: format.format,
        resolutionNumber: resolution,
        resolutionText: getDouyinResolutionText(resolution),
        urlList: format.play_addr.url_list
          .slice()
          .sort((left, right) => left.length - right.length),
      }
    })
    .sort((left, right) =>
      left.resolutionNumber === right.resolutionNumber
        ? right.bitRate - left.bitRate
        : right.resolutionNumber - left.resolutionNumber,
    )
  if (formats.length === 0) return null
  const hashtags = Array.isArray(aweme.text_extra)
    ? aweme.text_extra
        .filter((extra) => extra && extra.hashtag_name)
        .map((extra) => '#' + extra.hashtag_name)
    : []
  let description = aweme.desc || ''
  hashtags.forEach((hashtag) => {
    description = description.replace(new RegExp(hashtag, 'i'), '')
  })
  const format = formats[0]
  const author = aweme.author && aweme.author.nickname ? '@' + aweme.author.nickname : ''
  const filename =
    sanitizeDownloadName([author, description, format.resolutionText].filter(Boolean).join(' ')) ||
    aweme.aweme_id ||
    'douyin-video'
  return {
    url: format.urlList[0],
    filename: 'douyin/' + ensureFilenameExtension(filename, 'mp4'),
  }
}

async function downloadDouyinAwemeVideo(message, sender) {
  const data = message.data || {}
  const tabId = sender && sender.tab ? sender.tab.id : null
  const awemeId = String(data.vid || data.awemeId || '').trim()
  if (!/^\d+$/.test(awemeId)) throw new Error('解析视频信息失败，未找到抖音视频ID')
  await sendDouyinDownloadStatus(
    tabId,
    DOUYIN_SNACKBAR_TEXT.parseInformation + '\n' + awemeId,
    'info',
    2000,
  )
  const aweme = await fetchDouyinAwemeDetail(awemeId, tabId)
  if (!aweme) {
    await sendDouyinDownloadStatus(
      tabId,
      DOUYIN_SNACKBAR_TEXT.parseInformationFail + '\n' + awemeId,
      'error',
      2000,
    )
    return {
      type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_RESP,
      success: false,
      error: DOUYIN_SNACKBAR_TEXT.parseInformationFail,
    }
  }
  const downloadInfo = buildDouyinVideoDownloadInfo(aweme)
  if (!downloadInfo || !downloadInfo.url) {
    await sendDouyinDownloadStatus(
      tabId,
      DOUYIN_SNACKBAR_TEXT.parseInformationFail + '\n' + awemeId,
      'error',
      2000,
    )
    return {
      type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_RESP,
      success: false,
      error: DOUYIN_SNACKBAR_TEXT.parseInformationFail,
    }
  }
  const media = await probeMediaFile(downloadInfo.url, {
    trustedVideo: true,
  })
  if (media.kind !== 'video') throw new Error('该作品未返回可直接保存的视频文件。')
  const downloadId = await chrome.downloads.download({
    url: media.url,
    filename: downloadInfo.filename,
    saveAs: false,
    conflictAction: 'uniquify',
  })
  let startNotified = false
  const onDownloadChanged = (change) => {
    if (change.id !== downloadId) return
    if (change.error) {
      const errorCode = change.error.current
      if (errorCode && errorCode === 'NETWORK_FAILED') return
      if (errorCode !== 'USER_CANCELED') {
        sendDouyinDownloadStatus(
          tabId,
          DOUYIN_SNACKBAR_TEXT.downloadFailed + '\n' + downloadInfo.filename,
          'error',
          2000,
        )
      }
      chrome.downloads.onChanged.removeListener(onDownloadChanged)
      return
    }
    if (change.filename && !startNotified) {
      startNotified = true
      sendDouyinDownloadStatus(
        tabId,
        DOUYIN_SNACKBAR_TEXT.startDownload + '\n' + downloadInfo.filename,
        'info',
        2000,
      )
      return
    }
    if (change.state && change.state.current === 'complete') {
      sendDouyinDownloadStatus(
        tabId,
        DOUYIN_SNACKBAR_TEXT.completeDownload + '\n' + downloadInfo.filename,
        'success',
        2000,
      )
      chrome.downloads.onChanged.removeListener(onDownloadChanged)
    }
  }
  chrome.downloads.onChanged.addListener(onDownloadChanged)
  return {
    type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_RESP,
    success: true,
    downloadId,
    filename: downloadInfo.filename,
    url: downloadInfo.url,
  }
}

function getResponseHeader(headers, name) {
  if (!Array.isArray(headers)) return ''
  const lowerName = name.toLowerCase()
  const header = headers.find(
    (candidate) => candidate && candidate.name && candidate.name.toLowerCase() === lowerName,
  )
  return header && header.value ? String(header.value).toLowerCase() : ''
}

function getGenericUrlParts(url) {
  try {
    const parsedUrl = new URL(url)
    const pathname = decodeURIComponent(parsedUrl.pathname || '')
    const name = pathname.split('/').filter(Boolean).pop() || ''
    const extensionMatch = name.toLowerCase().match(/\.([a-z0-9]{2,5})$/)
    return {
      host: parsedUrl.hostname,
      name,
      extension: extensionMatch ? extensionMatch[1] : '',
    }
  } catch (error) {
    return {
      host: '',
      name: '',
      extension: '',
    }
  }
}

async function isSupportedCommerceTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId)
    return canCaptureSource(tab.url) && !videoPage(tab.url)
  } catch {
    return false
  }
}

async function notifyVideoUpdate(tabId) {
  if (!tabId) return
  try {
    const items = await getGenericMediaList(tabId)
    await chrome.tabs.sendMessage(tabId, {
      type: 'GENERIC_VIDEO_UPDATE',
      items,
    })
  } catch (error) {
    chrome.runtime.lastError
  }
}

async function notifyVideoHide(tabId) {
  if (!tabId) return
  try {
    await chrome.tabs.sendMessage(tabId, {
      type: 'GENERIC_VIDEO_HIDE',
    })
  } catch (error) {
    chrome.runtime.lastError
  }
}

function getGenericExtensionFromContentType(contentType) {
  const type = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase()
  if (type === 'video/mp4') return 'mp4'
  if (type === 'video/webm') return 'webm'
  if (type === 'video/ogg') return 'ogv'
  if (type === 'video/quicktime') return 'mov'
  if (type === 'video/x-m4v') return 'm4v'
  return ''
}

function normalizeGenericUrlForCompare(url) {
  try {
    const parsedUrl = new URL(url)
    parsedUrl.hash = ''
    return parsedUrl.toString()
  } catch (error) {
    return String(url || '')
  }
}

function isHttpDownloadUrl(url) {
  return /^https?:\/\//i.test(String(url || ''))
}

function isGenericDirectVideoUrl(url, contentType) {
  return /^https?:\/\//i.test(url) && mediaType(url, contentType) === 'video'
}

function serializeGenericMediaCache() {
  const stored = {}
  GENERIC_MEDIA_BY_TAB_ID.forEach((items, tabId) => {
    stored[String(tabId)] = items.slice(0, GENERIC_MEDIA_MAX_ITEMS)
  })
  return stored
}
let genericMediaSave
let genericMediaDirty = false

function saveGenericMediaCache() {
  genericMediaDirty = true
  if (genericMediaSave) return genericMediaSave
  // Network bursts share one in-flight write, followed by the latest cache state.
  genericMediaSave = (async () => {
    do {
      genericMediaDirty = false
      await chrome.storage.local.set({
        [GENERIC_MEDIA_STORAGE_KEY]: serializeGenericMediaCache(),
      })
    } while (genericMediaDirty)
  })()
    .catch((error) => {
      console.error('保存网页视频记录失败', error)
    })
    .finally(() => {
      genericMediaSave = undefined
    })
  return genericMediaSave
}

function restoreGenericMediaCache() {
  // All readers and tab cleanup await the same startup read before changing the cache.
  if (!genericMediaRestore) {
    genericMediaRestore = (async () => {
      const stored = (await chrome.storage.local.get(GENERIC_MEDIA_STORAGE_KEY))[
        GENERIC_MEDIA_STORAGE_KEY
      ]
      if (!stored || typeof stored !== 'object') return
      for (const [key, items] of Object.entries(stored)) {
        const tabId = parseInt(key, 10)
        if (!Number.isInteger(tabId) || !Array.isArray(items)) continue
        GENERIC_MEDIA_BY_TAB_ID.set(
          tabId,
          items.filter((item) => item && item.url).slice(0, GENERIC_MEDIA_MAX_ITEMS),
        )
      }
    })().catch((error) => console.error('读取网页视频记录失败', error))
  }
  return genericMediaRestore
}

async function rememberGenericMedia(details) {
  if (
    !details ||
    details.tabId == null ||
    details.tabId < 0 ||
    !details.url ||
    details.url.includes('chrome-extension://')
  )
    return
  if (details.initiator && details.initiator.includes('extension://')) return
  // Most page responses are scripts, styles or images. Reject them before any tabs/storage IPC.
  const contentType = getResponseHeader(details.responseHeaders, 'content-type')
  const urlParts = getGenericUrlParts(details.url)
  if (!isGenericDirectVideoUrl(details.url, contentType)) return
  if (details.statusCode < 200 || details.statusCode >= 300) return
  const sourceTab = await chrome.tabs.get(details.tabId).catch(() => null)
  if (!sourceTab || !canCaptureSource(sourceTab.url) || videoPage(sourceTab.url)) return
  await restoreGenericMediaCache()
  if (
    (GENERIC_MEDIA_BY_TAB_ID.get(details.tabId) || []).some(
      (item) => item.url === details.url && item.mediaVerified,
    )
  )
    return
  let media
  if (/^video\//i.test(contentType)) {
    media = {
      kind: 'video',
      contentType,
      size: mediaSize(details.statusCode, (name) =>
        getResponseHeader(details.responseHeaders, name),
      ),
    }
  } else {
    try {
      media = await probeMediaFile(details.url)
    } catch {
      return
    }
    if (media.kind !== 'video') return
    const currentTab = await chrome.tabs.get(details.tabId).catch(() => null)
    if (currentTab?.url !== sourceTab.url) return
  }
  const item = {
    mediaVerified: true,
    sourceUrl: sourceTab.url,
    url: details.url,
    tabId: details.tabId,
    frameId: details.frameId,
    type: details.type || '',
    contentType: media.contentType,
    contentLength: media.size,
    extension: urlParts.extension || getGenericExtensionFromContentType(contentType) || 'mp4',
    name: urlParts.name,
    time: Date.now(),
  }
  const items = GENERIC_MEDIA_BY_TAB_ID.get(details.tabId) || []
  const normalizedUrl = normalizeGenericUrlForCompare(details.url)
  const existingIndex = items.findIndex(
    (candidate) => normalizeGenericUrlForCompare(candidate.url) === normalizedUrl,
  )
  const previous = items[existingIndex]
  if (
    previous &&
    Object.entries(item).every(([key, value]) => key === 'time' || previous[key] === value)
  )
    return
  if (existingIndex >= 0) {
    items.splice(existingIndex, 1)
  }
  items.unshift(item)
  if (items.length > GENERIC_MEDIA_MAX_ITEMS) {
    items.splice(GENERIC_MEDIA_MAX_ITEMS)
  }
  GENERIC_MEDIA_BY_TAB_ID.set(details.tabId, items)
  updateGenericMediaBadge(details.tabId)
  saveGenericMediaCache()
  notifyVideoUpdate(details.tabId)
}

async function clearGenericMedia(tabId) {
  if (tabId == null) return
  await restoreGenericMediaCache()
  const removed = GENERIC_MEDIA_BY_TAB_ID.delete(tabId)
  void notifyVideoHide(tabId)
  if (removed) await saveGenericMediaCache()
}

function updateGenericMediaBadge(tabId) {
  return
}

function formatGenericMediaSize(size) {
  const bytes = Number(size || 0)
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes >= 1073741824) return (bytes / 1024 / 1024 / 1024).toFixed(2) + 'GB'
  return (bytes / 1024 / 1024).toFixed(2) + 'MB'
}

function getGenericMediaDisplayName(item, index) {
  const baseName = item && item.name ? String(item.name).replace(/\.[a-z0-9]{2,5}$/i, '') : ''
  const filename = sanitizeDownloadName(baseName) || 'video-' + (index + 1)
  return ensureFilenameExtension(
    filename,
    item.extension || getGenericExtensionFromContentType(item.contentType) || 'mp4',
  )
}

async function getGenericMediaList(tabId) {
  await restoreGenericMediaCache()
  const items = tabId == null ? [] : GENERIC_MEDIA_BY_TAB_ID.get(tabId) || []
  const tab = items.length ? await chrome.tabs.get(tabId).catch(() => null) : null
  return items
    .filter(
      (item) =>
        item.mediaVerified &&
        item.sourceUrl === tab?.url &&
        mediaType(item.url, item.contentType) !== 'audio',
    )
    .map((item, index) => ({
      id: normalizeGenericUrlForCompare(item.url),
      index,
      url: item.url,
      name: getGenericMediaDisplayName(item, index),
      size: item.contentLength || 0,
      sizeText: formatGenericMediaSize(item.contentLength),
      extension: item.extension || getGenericExtensionFromContentType(item.contentType) || 'mp4',
      contentType: item.contentType || '',
      time: item.time || 0,
    }))
}

function getMessageTabId(message, sender) {
  const data = message && message.data ? message.data : {}
  const candidateTabId = data.tabId != null ? data.tabId : message && message.tabId
  const tabId = Number.isInteger(candidateTabId)
    ? candidateTabId
    : parseInt(String(candidateTabId || ''), 10)
  if (Number.isInteger(tabId)) return tabId
  return sender && sender.tab && Number.isInteger(sender.tab.id) ? sender.tab.id : null
}

async function downloadGenericMediaItem(message, sender) {
  await restoreGenericMediaCache()
  const data = message.data || {}
  const tabId = getMessageTabId(message, sender)
  if (!Number.isInteger(tabId)) throw new Error('未找到当前标签页')
  const normalizedUrl = normalizeGenericUrlForCompare(data.url || '')
  const items = GENERIC_MEDIA_BY_TAB_ID.get(tabId) || []
  let item = items.find(
    (candidate) => normalizeGenericUrlForCompare(candidate.url) === normalizedUrl,
  )
  if (!item) {
    if (!data.directVideo || !isHttpDownloadUrl(data.url))
      throw new Error('视频地址已失效，请重新播放视频后再试')
    const urlParts = getGenericUrlParts(data.url)
    item = {
      url: data.url,
      contentType: data.contentType || '',
      extension:
        urlParts.extension || getGenericExtensionFromContentType(data.contentType) || 'mp4',
      name: urlParts.name,
    }
  }
  if (!(await isSupportedCommerceTab(tabId))) throw new Error('当前网页不支持视频下载。')
  const media = await probeMediaFile(item.url, {
    trustedVideo: Boolean(item.mediaVerified),
  })
  if (media.kind !== 'video') throw new Error('该地址不是可直接保存的视频文件。')
  const baseName =
    sanitizeDownloadName(data.filename || data.pageTitle || item.name || 'video') || 'video'
  const filename =
    'videos/' +
    ensureFilenameExtension(
      baseName,
      item.extension || getGenericExtensionFromContentType(item.contentType) || 'mp4',
    )
  const downloadId = await chrome.downloads.download({
    url: media.url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  })
  return {
    success: true,
    downloadId,
    filename,
    url: item.url,
  }
}

function initializeDouyinVideoDownloader() {
  if (!chrome.webRequest || !chrome.webRequest.onBeforeRequest) return
  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      rememberDouyinDetailParams(details)
    },
    {
      urls: [DOUYIN_DETAIL_PATTERN],
    },
  )
}

function initializeGenericVideoDownloader() {
  if (!chrome.webRequest || !chrome.webRequest.onResponseStarted) return
  restoreGenericMediaCache()
  chrome.webRequest.onResponseStarted.addListener(
    (details) => {
      void rememberGenericMedia(details).catch(() => {})
    },
    {
      urls: ['http://*/*', 'https://*/*'],
    },
    ['responseHeaders'],
  )
  if (chrome.tabs && chrome.tabs.onUpdated) {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo && changeInfo.status === 'loading') {
        clearGenericMedia(tabId)
      }
      if (changeInfo && changeInfo.status === 'complete' && tab && tab.url) {
        notifyVideoUpdate(tabId)
      }
    })
  }
  if (chrome.tabs && chrome.tabs.onRemoved) {
    chrome.tabs.onRemoved.addListener((tabId) => clearGenericMedia(tabId))
  }
}
initializeDouyinVideoDownloader()
initializeGenericVideoDownloader()
listenMessages(
  new Set([
    'OPEN_TAB',
    'VIDEO_OPENED_TO_BACK',
    'DOWNLOAD_FILE',
    ...Object.values(DOUYIN_MESSAGE_TYPES),
    ...Object.values(GENERIC_VIDEO_MESSAGE_TYPES),
  ]),
  (message, sender, sendResponse) => {
    if (message.type === 'OPEN_TAB') {
      const url = message.url + (message.url.includes('?') ? '&' : '?') + 'url_fetch=true'
      try {
        const tabOptions = {
          url,
          active: false,
        }
        chrome.tabs.create(tabOptions, (tab) => {
          if (chrome.runtime.lastError) {
            console.error('创建标签页失败:', chrome.runtime.lastError)
          } else {
            console.log('标签页创建成功:', tab.id)
          }
        })
      } catch (error) {
        console.error('标签页操作失败:', error)
      }
    } else if (message.type === 'VIDEO_OPENED_TO_BACK') {
      console.log('Background收到视频打开消息:', message.url)
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach((tab) => {
          try {
            const notification = {
              type: 'VIDEO_OPENED_TO_CONTENT',
              url: message.url,
            }
            chrome.tabs.sendMessage(tab.id, notification, (response) => {
              if (chrome.runtime.lastError) {
                console.log('标签页 ' + tab.id + ' 连接失败:', chrome.runtime.lastError.message)
              }
            })
          } catch (error) {
            console.log('发送消息到标签页 ' + tab.id + ' 失败:', error.message)
          }
        })
      })
    }
    switch (message.type) {
      case 'DOWNLOAD_FILE':
        downloadFile(message.url, message.filename, message.folderName)
          .then((downloadId) => {
            const result = {
              success: true,
              downloadId,
            }
            sendResponse(result)
          })
          .catch((error) => {
            console.error('下载文件失败:', error)
            sendResponse({
              success: false,
              error: error.message,
            })
          })
        return true
      case DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_REQ:
        downloadDouyinAwemeVideo(message, sender)
          .then((result) => {
            sendResponse({
              type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_RESP,
              success: result.success !== false,
              downloadId: result.downloadId,
              filename: result.filename,
              url: result.url,
            })
          })
          .catch((error) => {
            const tabId = sender && sender.tab ? sender.tab.id : null
            sendDouyinDownloadStatus(tabId, DOUYIN_SNACKBAR_TEXT.downloadFailed, 'error', 2000)
            sendResponse({
              type: DOUYIN_MESSAGE_TYPES.DOWNLOAD_VIDEO_RESP,
              success: false,
              error: error.message,
            })
          })
        return true
      case DOUYIN_MESSAGE_TYPES.ERROR_FIND_VID_REQ:
        sendResponse({
          success: true,
        })
        return false
      case GENERIC_VIDEO_MESSAGE_TYPES.LIST_REQ:
        const tabId = getMessageTabId(message, sender)
        isSupportedCommerceTab(tabId)
          .then((supported) => {
            if (!supported) {
              sendResponse({
                success: true,
                items: [],
              })
              return
            }
            return getGenericMediaList(tabId)
          })
          .then((items) => {
            if (items) {
              sendResponse({
                success: true,
                items,
              })
            }
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error.message,
            })
          })
        return true
      case GENERIC_VIDEO_MESSAGE_TYPES.CLEAR_REQ:
        clearGenericMedia(message.tabId).then(() =>
          sendResponse({
            success: true,
          }),
        )
        return true
      case GENERIC_VIDEO_MESSAGE_TYPES.DOWNLOAD_ITEM_REQ:
        downloadGenericMediaItem(message, sender)
          .then((result) => {
            sendResponse(result)
          })
          .catch((error) => {
            sendResponse({
              success: false,
              error: error.message,
            })
          })
        return true
    }
  },
)
