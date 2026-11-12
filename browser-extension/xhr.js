/**
 * AI module map
 * Purpose: MAIN-world commerce response interception and floating data/download interface.
 * Entry: manifest injects this script into the supported commerce routes and frames.
 * Flow: intercepted commerce responses populate rank/video data and the page interface; window messages connect download and tab actions to content.js.
 * State: rank lists, video identity sets, copied counts, and the last intercepted API are scoped to this page script.
 * Presentation: commerce-ui.css and layout helpers separate fixed controls, scrolling groups, metrics, and associated videos.
 * Selection: main actions span all rows; detail actions only read their object's videos. Existing node handlers/indexes are retained.
 * Identity: only explicit video fields identify media; cover images never supply download URLs.
 * Boundary: keep source readable and preserve window-message payloads; extension APIs are reached through the isolated bridge. Packaging alone transforms the staged copy.
 */
let rankList = [],
  totalCopiedCount = 0,
  genericRankList = [],
  genericVideoIdSet = new Set(),
  rankVideoIdSet = new Set(),
  lastInterceptedApi = '',
  authorVideoRankApi = '/compass_api/author/video_rank/rank_list',
  shopVideoRankApi = '/compass_api/shop/video/video_rank/bring_good_flow_hot_v2',
  mallMarketRankApi = '/compass_api/shop/mall/market/common_rank',
  authorProductVideoRankApi = '/compass_api/author/product/douyin_prod_rank/short_video_rank',
  shopProductVideoRankApi = '/compass_api/shop/product/product_rank/video_bring_good',
  productFlowSourceApi = '/compass_api/shop/product/compete_product_detail/flow_source/flow_source',
  mallVideoAfterWatchApi = '/compass_api/shop/mall/video_rank/after_watch',
  productFlowMoreApi = '/compass_api/shop/product/compete_product_detail/flow_source/flow_more',
  productVideoRankApi = '/compass_api/shop/video/compete_video/product_video_rank',
  shopDetailIndexApi = '/compass_api/shop/mall/market/shop_detail_index_list',
  liveDrainageVideoListApi = '/compass_api/shop/live/compete_room/drainage_video_list',
  liveRankBoardApi = '/compass_api/shop/live/live_rank/board_list_v2',
  competeProductDetailApi = '/compass_api/shop/product/compete_product_detail'
function isGenericVideoCollectPage() {
  const pageUrl = window.location.href
  return pageUrl.startsWith(
    'https://buyin.jinritemai.com/dashboard/merch-picking-library/merch-promoting',
  )
}
function collectGenericVideoItems(payload, collectedRows) {
  if (!payload || typeof payload !== 'object') return
  if (Array.isArray(payload)) {
    payload.forEach((item) => collectGenericVideoItems(item, collectedRows))
    return
  }
  const videoId =
    payload.video_id ??
    payload.videoId ??
    (payload.video_play_url ||
    payload.play_url ||
    payload.video_url ||
    payload.video_name ||
    payload.video_title
      ? payload.aweme_id
      : null) ??
    null
  videoId !== null &&
    videoId !== '' &&
    collectedRows.push({
      name:
        payload.author_name ||
        payload.nick_name ||
        payload.video_author_name ||
        payload.video_name ||
        payload.video_title ||
        payload.title ||
        '视频',
      id: payload.author_id || payload.video_author_id || '',
      rank: '',
      checked: false,
      videos: [
        {
          video_id: String(videoId),
          video_play_url: payload.video_play_url || payload.play_url || payload.video_url || '',
          video_name: payload.video_name || payload.video_title || payload.title || '',
          video_img:
            payload.video_image ||
            payload.video_img ||
            payload.video_cover ||
            payload.cover_url ||
            '',
        },
      ],
    })
  const mediaInfo = payload.media_info
  if (
    payload.content_id &&
    payload.content_id !== '' &&
    mediaInfo &&
    typeof mediaInfo === 'object' &&
    (mediaInfo.video_url || payload.content_type === 'video')
  ) {
    const extraMetrics = {
      author_fans_count: payload.author_fans_count ?? 0,
      author_resident: payload.author_resident || '',
      author_level: payload.author_level ?? '',
      is_self_sale: !!payload.is_self_sale,
      format_sales: payload.format_sales || '',
      format_sales_amount: payload.format_sales_amount || '',
      play_count: payload.play_count ?? 0,
      like_count: payload.like_count ?? 0,
      publish_time: payload.publish_time || '',
    }
    collectedRows.push({
      name: payload.author_name || payload.content_title || '视频',
      id: payload.author_sec_id || '',
      rank: '',
      imgUrl: payload.author_avatar || '',
      checked: false,
      extra: extraMetrics,
      videos: [
        {
          video_id: String(payload.content_id),
          video_play_url: mediaInfo.video_url || '',
          video_name: payload.content_title || '',
          video_img: payload.content_cover || mediaInfo.cover_url || '',
        },
      ],
    })
  }
  Object.keys(payload).forEach((key) => {
    const nestedValue = payload[key]
    nestedValue &&
      typeof nestedValue === 'object' &&
      collectGenericVideoItems(nestedValue, collectedRows)
  })
}
function mergeGenericVideoItems(response) {
  const collectedRows = []
  collectGenericVideoItems(
    response && response.data !== undefined ? response.data : response,
    collectedRows,
  )
  collectedRows.forEach((row) => {
    const videoId = row.videos[0].video_id
    if (genericVideoIdSet.has(videoId)) return
    genericVideoIdSet.add(videoId)
    genericRankList.push(row)
  })
  updateBadgeCount()
}
function mergeRankListItems(incomingRows) {
  if (!Array.isArray(incomingRows)) return
  incomingRows.forEach((row) => {
    if (!row || !Array.isArray(row.videos) || row.videos.length === 0) return
    const videoIds = row.videos.map((video) => video.video_id).filter(Boolean)
    if (videoIds.length === 0) return
    const allVideosSeen = videoIds.every((videoId) => rankVideoIdSet.has(String(videoId)))
    if (allVideosSeen) return
    videoIds.forEach((videoId) => rankVideoIdSet.add(String(videoId)))
    rankList.push(row)
  })
  updateBadgeCount()
}
function updateBadgeCount() {
  const badge = document.getElementById('xm-download-badge')
  if (!badge) return
  const countLabel = badge.querySelector('.xm-badge-count')
  if (countLabel) {
    const countVideos = (rows) =>
        (rows || []).reduce(
          (total, row) => total + (row.videos || []).filter((video) => video.video_id).length,
          0,
        ),
      videoCount = Math.max(countVideos(rankList), countVideos(genericRankList))
    countLabel.textContent = videoCount
    badge.style.display = videoCount > 0 ? 'flex' : 'none'
  }
}
function ensureAntdComponentStyles() {
  if (document.getElementById('xm-antd-component-style')) return
  const style = document.createElement('style')
  style.id = 'xm-antd-component-style'
  style.textContent = `
    .xm-ant-checkbox {
      appearance: none;
      -webkit-appearance: none;
      width: 16px;
      height: 16px;
      margin: 0;
      border: 1px solid #d9d9d9;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
      flex: 0 0 auto;
      position: relative;
      vertical-align: middle;
      transition: all .2s;
      box-sizing: border-box;
    }
    .xm-ant-checkbox:hover {
      border-color: #0052D9;
    }
    .xm-ant-checkbox:checked,
    .xm-ant-checkbox:indeterminate {
      background: #0052D9;
      border-color: #0052D9;
    }
    .xm-ant-checkbox:checked::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 1px;
      width: 5px;
      height: 9px;
      border: 2px solid #fff;
      border-top: 0;
      border-left: 0;
      transform: rotate(45deg);
    }
    .xm-ant-checkbox:indeterminate::after {
      content: "";
      position: absolute;
      left: 3px;
      right: 3px;
      top: 6px;
      height: 2px;
      background: #fff;
    }
    .xm-video-thumb-checkbox {
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 2;
      box-shadow: 0 1px 2px rgba(0, 0, 0, .12);
    }
    @keyframes xmNotificationSlideIn {
      from {
        opacity: 0;
        transform: translateX(24px);
      }
      to {
        opacity: 1;
        transform: translateX(0);
      }
    }
  `
  document.head.appendChild(style)
}
function hookRankApiXhr() {
  const originalOpen = XMLHttpRequest.prototype.open,
    originalSend = XMLHttpRequest.prototype.send
  XMLHttpRequest.prototype.open = function (method, url, ...openArguments) {
    this._url = url
    url &&
      (url.includes(shopProductVideoRankApi) ||
        url.includes(productFlowMoreApi) ||
        url.includes(competeProductDetailApi)) &&
      console.log('[XHR open] 命中目标接口:', url)
    return originalOpen.apply(this, [method, url, ...openArguments])
  }
  XMLHttpRequest.prototype.send = function (...sendArguments) {
    let requestUrl = this._url
    const isGenericPage = isGenericVideoCollectPage()
    if (
      this._url &&
      (isGenericPage ||
        this._url.includes(authorVideoRankApi) ||
        this._url.includes(shopVideoRankApi) ||
        this._url.includes(mallMarketRankApi) ||
        this._url.includes(authorProductVideoRankApi) ||
        this._url.includes(shopProductVideoRankApi) ||
        this._url.includes(mallVideoAfterWatchApi) ||
        this._url.includes(productFlowSourceApi) ||
        this._url.includes(productFlowMoreApi) ||
        this._url.includes(productVideoRankApi) ||
        this._url.includes(shopDetailIndexApi) ||
        this._url.includes(liveDrainageVideoListApi) ||
        this._url.includes(liveRankBoardApi) ||
        this._url.includes(competeProductDetailApi))
    ) {
      console.log('[XHR send] 匹配拦截:', requestUrl, '| isGenericPage:', isGenericPage)
      const originalOnload = this.onload
      this.onload = function () {
        ;(function () {
          try {
            let response = null
            try {
              const responseType = this.responseType
              if (responseType === 'json') response = this.response
              else if (responseType === '' || responseType === 'text') {
                let responseText = this.responseText
                if (responseText) {
                  const jsonPrefixes = [
                    'while(1);',
                    'while(true);',
                    'for(;;);',
                    ")] }',",
                    ")] }',",
                    ")] }'",
                  ]
                  for (const prefix of jsonPrefixes) {
                    if (responseText.startsWith(prefix)) {
                      responseText = responseText.slice(prefix.length)
                      break
                    }
                  }
                  responseText = responseText.trim()
                  response = JSON.parse(responseText)
                }
              }
            } catch (parseError) {
              return
            }
            if (!response) return
            console.log('拦截到目标响应', response)
            if (
              requestUrl.includes(productFlowMoreApi) ||
              (requestUrl.includes(competeProductDetailApi) &&
                !requestUrl.includes('/flow_source/'))
            )
              lastInterceptedApi = 'competeProductDetail'
            else if (requestUrl.includes(shopProductVideoRankApi))
              lastInterceptedApi = 'shopProductVideoRank'
            else if (requestUrl.includes(authorVideoRankApi)) lastInterceptedApi = 'authorVideoRank'
            else if (requestUrl.includes(shopVideoRankApi)) lastInterceptedApi = 'shopVideoRank'
            else if (requestUrl.includes(mallMarketRankApi)) lastInterceptedApi = 'mallMarketRank'
            else if (requestUrl.includes(authorProductVideoRankApi))
              lastInterceptedApi = 'authorProductVideoRank'
            else if (requestUrl.includes(mallVideoAfterWatchApi))
              lastInterceptedApi = 'mallVideoAfterWatch'
            else if (requestUrl.includes(productFlowSourceApi))
              lastInterceptedApi = 'productFlowSource'
            else if (requestUrl.includes(productVideoRankApi))
              lastInterceptedApi = 'productVideoRank'
            else if (requestUrl.includes(shopDetailIndexApi)) lastInterceptedApi = 'shopDetailIndex'
            else if (requestUrl.includes(liveDrainageVideoListApi))
              lastInterceptedApi = 'liveDrainageVideoList'
            else requestUrl.includes(liveRankBoardApi) && (lastInterceptedApi = 'liveRankBoard')
            isGenericPage && (lastInterceptedApi = 'generic')
            console.log('[XM-DEBUG] lastInterceptedApi:', lastInterceptedApi)
            let didMergeRows = false
            if (response && response.data) {
              const previousRows = rankList
              if (requestUrl.includes(authorVideoRankApi))
                rankList = response.data.video_ranking_detail.map((rankingItem) => {
                  const videoBase = rankingItem.video_base,
                    row = {
                      id: videoBase.author_id,
                      name: videoBase.author_name || '',
                      rank: rankingItem.rank_index.rank || '',
                      aweme: videoBase.aweme || '',
                      imgUrl: videoBase.video_img || videoBase.video_image,
                      checked: false,
                      videos: [
                        {
                          video_id: videoBase.video_id,
                          video_play_url: videoBase.video_play_url || '',
                          video_name: videoBase.video_name || '',
                          video_img: videoBase.video_img || videoBase.video_image,
                        },
                      ],
                    }
                  return row
                })
              else if (requestUrl.includes(shopVideoRankApi))
                rankList =
                  response.data.module_data.video_bring_goods_rank.compass_general_table_value.data.map(
                    (tableRow) => {
                      const videoData = tableRow.cell_info.video.video,
                        row = {
                          id: videoData.author.author_id,
                          name: videoData.author.nick_name || '',
                          rank: tableRow.cell_info.rank.index_values.value.value || '',
                          aweme: videoData.author.short_id,
                          imgUrl: videoData.video_cover,
                          checked: false,
                          videos: [
                            {
                              video_id: videoData.video_id,
                              video_play_url: videoData.play_url || '',
                              video_name: videoData.video_title || '',
                              video_img: videoData.video_cover || videoData.video_image,
                            },
                          ],
                        }
                      return row
                    },
                  )
              else if (requestUrl.includes(mallMarketRankApi))
                rankList = response?.data?.map((tableRow) => {
                  const videoList = tableRow?.row?.video_list?.video_list || [],
                    rankInfo = tableRow.row.rank_info.rank_info,
                    authorInfo = tableRow.row.author_dimension.author_dimension
                  return {
                    rank: rankInfo.rank_no || '',
                    id: authorInfo.author_id || '',
                    name: authorInfo.author_nick_name || '',
                    imgUrl: authorInfo.author_avatar_url || '',
                    checked: false,
                    videos: videoList.map((video) => ({
                      id: video.video_author_id || '',
                      name: video.video_author_name || '',
                      imgUrl: video.video_author_img || '',
                      video_id: video.video_id,
                      video_play_url: video.video_url || video.video_play_url || '',
                      video_img: video.video_image || video.video_img || '',
                      video_name: video.video_title || video.video_name || '',
                    })),
                  }
                })
              else if (requestUrl.includes(authorProductVideoRankApi))
                rankList = response.data.data_result.map((rankingItem) => {
                  const videoList = rankingItem.video_list,
                    productInfo = rankingItem.product_info
                  return {
                    id: productInfo.id || '',
                    name: productInfo.name || '',
                    rank: productInfo.rank || '',
                    imgUrl: productInfo.image_url,
                    checked: false,
                    videos: videoList.map((video) => ({
                      video_id: video.video_id,
                      video_play_url: video.video_play_url || '',
                      video_img: video.video_img,
                      video_name: video.video_name,
                    })),
                  }
                })
              else if (requestUrl.includes(shopProductVideoRankApi))
                rankList = response.data.data_result
                  .filter(
                    (rankingItem) => rankingItem.video_list && rankingItem.video_list.length > 0,
                  )
                  .map((rankingItem) => {
                    const productInfo = rankingItem.product_info || {},
                      shopInfo = productInfo.shop_info || productInfo.shop || {},
                      extraMetrics = {
                        payAmt: formatRangeValue(rankingItem.pay_amt),
                        productClickCnt: formatRangeValue(rankingItem.product_click_cnt),
                        payComboCnt: formatRangeValue(rankingItem.pay_combo_cnt),
                        videoCnt: formatRangeValue(rankingItem.video_cnt),
                        priceBin: productInfo.price_bin || '',
                      }
                    return {
                      name: productInfo.name || '',
                      id: productInfo.id || '',
                      imgUrl: productInfo.image_url || '',
                      rank: productInfo.rank || '',
                      shopName: productInfo.shop_name || shopInfo.name || shopInfo.shop_name || '',
                      checked: false,
                      extra: extraMetrics,
                      videos: (rankingItem.video_list || []).map((video) => {
                        const extraMetrics2 = {},
                          videoFields = new Set([
                            'author_id',
                            'author_name',
                            'author_img',
                            'publish_ts',
                            'video_img',
                            'video_id',
                            'video_play_url',
                            'video_name',
                          ])
                        Object.keys(video || {}).forEach((key) => {
                          !videoFields.has(key) && (extraMetrics2[key] = video[key])
                        })
                        return {
                          author_id: video.author_id || '',
                          author_name: video.author_name || '',
                          author_img: video.author_img || '',
                          publish_ts: video.publish_ts || 0,
                          video_img: video.video_img || '',
                          video_id: video.video_id,
                          video_play_url: video.video_play_url || '',
                          video_name: video.video_name || '',
                          extra: extraMetrics2,
                        }
                      }),
                    }
                  })
              else if (
                requestUrl.includes(competeProductDetailApi) &&
                !requestUrl.includes('/flow_source/')
              ) {
                didMergeRows = true
                const responseRows = Array.isArray(response.data)
                  ? response.data
                  : Array.isArray(response.data?.data)
                    ? response.data.data
                    : []
                rankList = responseRows.map((rankingItem) => {
                  const baseInfo = rankingItem.base_info || {},
                    videoBase = baseInfo.video_base_info || {},
                    authorInfo = videoBase.author_info || {},
                    metrics = rankingItem.metrics || {},
                    extraInfo = baseInfo.extra_info || {},
                    extraMetrics = {
                      publishTime: formatCompetePublishTime(videoBase.publish_time),
                      authorType: authorInfo.author_type,
                      fansCount: authorInfo.fans_count,
                      commentCnt: extraInfo.comment_cnt?.value,
                      watchCnt: extraInfo.watch_cnt?.value,
                      finishWatchRatio: extraInfo.finish_watch_ratio?.value,
                      payAmt: formatCompeteMetric(metrics.pay_amt),
                      payUcnt: formatCompeteMetric(metrics.pay_ucnt),
                      dhProductClickRatioUv: formatCompeteMetric(metrics.dh_product_click_ratio_uv),
                      payCnt: formatCompeteMetric(metrics.pay_cnt),
                      payComboCnt: formatCompeteMetric(metrics.pay_combo_cnt),
                    }
                  return {
                    name: authorInfo.author_nick_name || '',
                    id: String(authorInfo.author_id || ''),
                    aweme: authorInfo.aweme_id || '',
                    imgUrl: authorInfo.author_logo || '',
                    rank: String(authorInfo.author_type || ''),
                    checked: false,
                    extra: extraMetrics,
                    videos: [
                      {
                        video_id: String(videoBase.video_id || ''),
                        video_play_url: videoBase.video_url || '',
                        video_name: videoBase.video_title || '',
                        video_img: videoBase.video_image || '',
                      },
                    ],
                  }
                })
              } else if (requestUrl.includes(mallVideoAfterWatchApi))
                rankList = response.data.map((rankingItem) => {
                  const authorBase = rankingItem.base_info.author_base_info,
                    videoBase = rankingItem.base_info.video_base_info,
                    rankMetric = rankingItem.metrics.rank,
                    video = {
                      video_img: videoBase.video_image || '',
                      video_id: videoBase.video_id,
                      video_play_url: videoBase.video_play_url || '',
                      video_name: videoBase.video_title,
                    },
                    row = {
                      name: authorBase.author_nick_name,
                      id: authorBase.author_id,
                      imgUrl: authorBase.image_url || authorBase.author_logo || '',
                      rank: rankMetric.value.value,
                      checked: false,
                      videos: [video],
                    }
                  return row
                })
              else if (requestUrl.includes(productFlowSourceApi))
                rankList = response.data[0].child_rows.map((rankingItem) => {
                  let videoBase = rankingItem.base_info.video_base_info
                  const row = {
                    id: videoBase?.author_info.author_id || '',
                    aweme: videoBase.author_info.aweme_id || '',
                    imgUrl: videoBase?.author_info.author_logo || '',
                    rank: videoBase?.author_info.author_type || '',
                    name: videoBase?.author_info.author_nick_name || '',
                    checked: false,
                    videos: [
                      {
                        video_img: videoBase?.video_image,
                        video_id: videoBase?.video_id,
                        video_play_url: videoBase?.video_url || '',
                        video_name: videoBase?.video_title || '',
                      },
                    ],
                  }
                  return row
                })
              else if (requestUrl.includes(productFlowMoreApi)) {
                didMergeRows = true
                const responseRows = Array.isArray(response.data)
                  ? response.data
                  : Array.isArray(response.data?.data)
                    ? response.data.data
                    : []
                rankList = responseRows.map((rankingItem) => {
                  const baseInfo = rankingItem.base_info || {},
                    videoBase = baseInfo.video_base_info || {},
                    authorInfo = videoBase.author_info || {},
                    metrics = rankingItem.metrics || {},
                    extraInfo = baseInfo.extra_info || {},
                    extraMetrics = {
                      publishTime: formatCompetePublishTime(videoBase.publish_time),
                      authorType: authorInfo.author_type,
                      fansCount: authorInfo.fans_count,
                      commentCnt: extraInfo.comment_cnt?.value,
                      watchCnt: extraInfo.watch_cnt?.value,
                      finishWatchRatio: extraInfo.finish_watch_ratio?.value,
                      payAmt: formatCompeteMetric(metrics.pay_amt),
                      payUcnt: formatCompeteMetric(metrics.pay_ucnt),
                      dhProductClickRatioUv: formatCompeteMetric(metrics.dh_product_click_ratio_uv),
                      payCnt: formatCompeteMetric(metrics.pay_cnt),
                      payComboCnt: formatCompeteMetric(metrics.pay_combo_cnt),
                    }
                  return {
                    name: authorInfo.author_nick_name || '',
                    id: String(authorInfo.author_id || ''),
                    aweme: authorInfo.aweme_id || '',
                    imgUrl: authorInfo.author_logo || '',
                    rank: String(authorInfo.author_type || ''),
                    checked: false,
                    extra: extraMetrics,
                    videos: [
                      {
                        video_id: String(videoBase.video_id || ''),
                        video_play_url: videoBase.video_url || '',
                        video_name: videoBase.video_title || '',
                        video_img: videoBase.video_image || '',
                      },
                    ],
                  }
                })
              } else if (requestUrl.includes(productVideoRankApi))
                rankList =
                  response.data.module_data.compete_video_product_video_rank.compass_general_table_value.data.map(
                    (tableRow) => {
                      const videoData = tableRow.cell_info.video.video,
                        row = {
                          id: videoData.author.author_id || '',
                          name: videoData.author.nick_name || '',
                          rank: tableRow.cell_info.comment_cnt?.index_values?.value?.value || '',
                          aweme: videoData?.author?.short_id?.value?.value || '',
                          imgUrl: videoData.video_cover || '',
                          checked: false,
                          videos: [
                            {
                              video_id: videoData.video_id || '',
                              video_play_url: videoData.play_url || '',
                              video_name: videoData.video_title || '',
                              video_img: videoData.video_cover || videoData.video_image || '',
                            },
                          ],
                        }
                      return row
                    },
                  )
              else if (requestUrl.includes(shopDetailIndexApi)) {
                const shopRankTable =
                  response.data?.module_data?.search_shop_rank?.compass_general_table_value
                let firstCell = shopRankTable?.data[0]?.cell_info || {}
                Object.keys(firstCell).indexOf('video') !== -1 &&
                  (rankList =
                    shopRankTable?.data?.map((tableRow) => {
                      const cellInfo = tableRow?.cell_info || {},
                        videoData = cellInfo?.video?.video || {},
                        authorInfo = videoData?.author || {},
                        row = {
                          id: authorInfo?.author_id ?? '',
                          name: authorInfo?.nick_name ?? '',
                          rank: cellInfo?.rank?.index_values?.value?.value ?? '',
                          aweme: authorInfo?.short_id ?? '',
                          imgUrl: videoData?.video_cover ?? '',
                          checked: false,
                          videos: [
                            {
                              video_id: videoData?.video_id ?? '',
                              video_play_url: videoData?.play_url ?? '',
                              video_name: videoData?.video_title ?? '',
                              video_img: videoData?.video_cover ?? videoData?.video_image ?? '',
                            },
                          ],
                        }
                      return row
                    }) || {})
              } else if (requestUrl.includes(liveDrainageVideoListApi)) {
                const drainageVideoTable =
                  response.data?.module_data?.compete_room_drainage_video_list
                    ?.compass_general_table_value
                let firstCell = drainageVideoTable?.data[0]?.cell_info || {}
                Object.keys(firstCell).indexOf('video') !== -1 &&
                  (rankList =
                    drainageVideoTable?.data?.map((tableRow) => {
                      const cellInfo = tableRow?.cell_info || {},
                        videoData = cellInfo?.video?.video || {},
                        row = {
                          id: videoData?.video_id ?? '',
                          name: videoData?.video_title ?? '',
                          rank: videoData?.video_status ?? '',
                          aweme: videoData?.publish_time ?? '',
                          imgUrl: videoData?.video_cover ?? '',
                          checked: false,
                          videos: [
                            {
                              video_id: videoData?.video_id ?? '',
                              video_play_url: videoData?.play_url ?? '',
                              video_name: videoData?.video_title ?? '',
                              video_img: videoData?.video_cover ?? videoData?.video_image ?? '',
                            },
                          ],
                        }
                      return row
                    }) || {})
              } else
                requestUrl.includes(liveRankBoardApi) &&
                  (rankList = (
                    response.data?.module_data?.live_trade_flow_rank?.compass_general_table_value
                      ?.data || []
                  ).map((tableRow) => {
                    const videoList = tableRow.cell_info?.drainage_video_list?.video_list || []
                    return {
                      id: tableRow.cell_info?.room?.room?.author?.author_id || '',
                      name: tableRow.cell_info?.room?.room?.author?.nick_name || '',
                      rank: tableRow.cell_info?.rank?.index_values?.value?.value || '',
                      aweme: tableRow.cell_info?.room?.room?.author?.short_id || '',
                      imgUrl: tableRow.cell_info?.room?.room?.author?.cover_url || '',
                      checked: false,
                      videos: videoList.map((video) => ({
                        video_id: video.video_id || '',
                        video_play_url: video.play_url || '',
                        video_name: video.video_title || '',
                        video_img: video.video_cover || video.video_image || '',
                      })),
                    }
                  }))
              if (rankList !== previousRows) {
                const parsedRows = rankList
                rankList = previousRows
                mergeRankListItems(parsedRows)
              }
            }
            isGenericPage && response && !didMergeRows && mergeGenericVideoItems(response)
          } catch (parseError) {
            console.error('❌ 解析API响应失败:', parseError)
          }
        }).call(this)
        originalOnload && originalOnload.apply(this, arguments)
      }
      const originalOnerror = this.onerror
      this.onerror = function () {
        console.error('❌ XHR请求失败')
        originalOnerror && originalOnerror.call(this)
      }
    }
    return originalSend.apply(this, sendArguments)
  }
  console.log('✅ XHR拦截设置完成')
}
function hookFetchDebug() {
  const originalFetch = window.fetch
  window.fetch = async function (...fetchArguments) {
    const requestUrl =
      typeof fetchArguments[0] === 'string'
        ? fetchArguments[0]
        : (fetchArguments[0] && fetchArguments[0].url) || ''
    requestUrl &&
      (requestUrl.includes(shopProductVideoRankApi) ||
        requestUrl.includes(productFlowMoreApi) ||
        requestUrl.includes(competeProductDetailApi)) &&
      console.log('[Fetch] 命中目标接口:', requestUrl)
    return originalFetch.apply(this, fetchArguments)
  }
  console.log('✅ Fetch调试hook设置完成')
} // Match only the clicked cover or the exact video title and author in its row.
// Author/product images and neighboring thumbnails must never identify another video.
function bindVideoCardClickHandlers() {
  const imageCards =
    location.pathname.includes('/shop/chance/video-talent-rank') ||
    location.pathname.includes('/talent/product-rank')
  document.body.addEventListener('click', (event) => {
    const target = event.target
    if (
      !(target instanceof Element) ||
      target.closest(
        '.dlc-commerce-overlay, #xm-download-badge, #xm-notification-container, #xm-progress-container',
      )
    )
      return
    const cover = target.closest(
      "[class*='cover-'], [class*='videoWrapper'], [class*='videoIcon-'], [class*='img-success-mask']",
    )
    const image = target.tagName === 'IMG' ? target : target.querySelector(':scope > img')
    if (!cover && !(imageCards && image)) return
    const video = findVideoByTableCell(target) || findVideoByElementImages(image || cover)
    if (!video) return
    event.stopPropagation()
    openDouyinVideoDetail(video)
  })
}
function findVideoByElementImages(element) {
  if (!element) return null
  const images = element.tagName === 'IMG' ? [element] : element.querySelectorAll('img')
  const sources = new Set(Array.from(images, (image) => image.currentSrc || image.src))
  const matches = new Map()
  for (const row of rankList) {
    for (const video of row.videos || []) {
      if (video.video_id && video.video_img && sources.has(video.video_img)) {
        matches.set(String(video.video_id), video)
      }
    }
  }
  return matches.size === 1 ? matches.values().next().value : null
}
function findVideoByTableCell(element) {
  const cell = element.closest('td')
  if (!cell) return null
  const author = cell.querySelector("div[class*='authorName']")
  const title = cell.querySelector("div[class*='videoName']")
  const aweme = cell.querySelector("span[class*='aweme']")
  if (!author || !title || !aweme) return null
  const authorName = author.textContent.trim()
  const videoName = (title.getAttribute('title') || title.textContent).trim()
  const authorHandle = aweme.textContent.trim()
  const matches = new Map()
  for (const row of rankList) {
    if (row.name !== authorName || String(row.aweme || '') !== authorHandle) continue
    for (const video of row.videos || []) {
      if (video.video_id && video.video_name === videoName)
        matches.set(String(video.video_id), video)
    }
  }
  return matches.size === 1 ? matches.values().next().value : null
}
function showToast(message) {
  ensureAntdComponentStyles()
  let container = document.getElementById('xm-notification-container')
  !container &&
    ((container = document.createElement('div')),
    (container.id = 'xm-notification-container'),
    (container.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 2147483647;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
        width: min(384px, calc(100vw - 48px));
        pointer-events: none;
    `),
    document.body.appendChild(container))
  const toast = document.createElement('div')
  toast.style.cssText = `
        width: 100%;
        min-height: 78px;
        background: #fff;
        color: rgba(0, 0, 0, .88);
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 6px 16px 0 rgba(0, 0, 0, .08), 0 3px 6px -4px rgba(0, 0, 0, .12), 0 9px 28px 8px rgba(0, 0, 0, .05);
        pointer-events: auto;
        display: flex;
        gap: 14px;
        box-sizing: border-box;
        animation: xmNotificationSlideIn .2s ease-out;
    `
  const status =
      message.includes('✅') ||
      message.includes('成功') ||
      message.includes('已创建') ||
      message.includes('已复制')
        ? 'success'
        : message.includes('❌') || (message.includes('失败') && !message.includes('失败: 0'))
          ? 'error'
          : 'info',
    statusColors = {
      info: '#475569',
      success: '#16a34a',
      error: '#dc2626',
    },
    accent = document.createElement('div')
  accent.textContent = status === 'error' ? '!' : status === 'success' ? '✓' : 'i'
  accent.style.cssText =
    `
        width: 24px;
        height: 24px;
        margin-top: 2px;
        border-radius: 50%;
        background: ` +
    statusColors[status] +
    `;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 15px;
        font-weight: 600;
        line-height: 1;
        flex: 0 0 auto;
    `
  const content = document.createElement('div')
  content.style.cssText =
    '\n        flex: 1;\n        min-width: 0;\n        padding-right: 8px;\n    '
  const title = document.createElement('div')
  title.textContent = '大懒虫短视频下载'
  title.style.cssText = `
        color: rgba(0, 0, 0, .88);
        font-size: 16px;
        font-weight: 500;
        line-height: 1.5;
        margin-bottom: 4px;
    `
  const messageLabel = document.createElement('div')
  messageLabel.textContent = message.replace(/[✅❌📁]\s*/g, '')
  messageLabel.style.cssText = `
        color: rgba(0, 0, 0, .65);
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5715;
        word-break: break-word;
        white-space: normal;
    `
  const closeButton = document.createElement('button')
  closeButton.textContent = '×'
  closeButton.style.cssText = `
        width: 22px;
        height: 22px;
        border: none;
        background: transparent;
        color: rgba(0, 0, 0, .45);
        cursor: pointer;
        padding: 0;
        border-radius: 4px;
        font-size: 20px;
        line-height: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .2s, color .2s;
        flex: 0 0 auto;
    `
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, .04)'
    closeButton.style.color = 'rgba(0, 0, 0, .88)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'transparent'
    closeButton.style.color = 'rgba(0, 0, 0, .45)'
  })
  content.appendChild(title)
  content.appendChild(messageLabel)
  toast.dataset.status = status
  messageLabel.classList.add('dlc-commerce-status-text')
  toast.appendChild(accent)
  toast.appendChild(content)
  prepareCommerceCloseButton(closeButton)
  toast.appendChild(closeButton)
  container.appendChild(toast)
  const dismiss = () => {
    toast.parentNode && toast.parentNode.removeChild(toast)
    container &&
      container.parentNode &&
      container.children.length === 0 &&
      container.parentNode.removeChild(container)
  }
  closeButton.addEventListener('click', dismiss)
  setTimeout(dismiss, 4500)
}
let progressToastId = 0,
  activeProgressToast = null
function showProgressToast(message, percentage, status) {
  ensureAntdComponentStyles()
  let container = document.getElementById('xm-progress-container')
  !container &&
    ((container = document.createElement('div')),
    (container.id = 'xm-progress-container'),
    (container.style.cssText = `
        position: fixed;
        top: 80px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2147483647;
        width: min(480px, calc(100vw - 32px));
        pointer-events: none;
    `),
    document.body.appendChild(container))
  activeProgressToast &&
    activeProgressToast.parentNode &&
    activeProgressToast.parentNode.removeChild(activeProgressToast)
  const toastId = ++progressToastId,
    toast = document.createElement('div')
  toast.dataset.progressId = toastId
  toast.style.cssText = `
        background: #fff;
        color: rgba(0, 0, 0, .88);
        padding: 12px 18px;
        border-radius: 8px;
        box-shadow: 0 6px 16px 0 rgba(0, 0, 0, .08), 0 3px 6px -4px rgba(0, 0, 0, .12), 0 9px 28px 8px rgba(0, 0, 0, .05);
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 12px;
        box-sizing: border-box;
        animation: xmNotificationSlideIn .2s ease-out;
        min-height: 48px;
    `
  const statusColors = {
      info: '#475569',
      success: '#16a34a',
      error: '#dc2626',
    },
    currentStatus = status || 'info',
    accent = document.createElement('div')
  accent.textContent = currentStatus === 'error' ? '!' : currentStatus === 'success' ? '✓' : 'i'
  accent.style.cssText =
    `
        width: 20px;
        height: 20px;
        border-radius: 50%;
        background: ` +
    statusColors[currentStatus] +
    `;
        color: #fff;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        flex: 0 0 auto;
    `
  const messageLabel = document.createElement('div')
  messageLabel.textContent = message
  messageLabel.style.cssText = `
        color: rgba(0, 0, 0, .88);
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5;
        flex: 1;
        min-width: 0;
    `
  const track = document.createElement('div')
  track.style.cssText = `
        width: 120px;
        height: 4px;
        background: #F3F3F3;
        border-radius: 2px;
        overflow: hidden;
        flex: 0 0 auto;
    `
  const bar = document.createElement('div')
  bar.style.cssText =
    '\n        width: ' +
    Math.max(0, Math.min(100, percentage || 0)) +
    '%;\n        height: 100%;\n        background: ' +
    statusColors[currentStatus] +
    ';\n        border-radius: 2px;\n        transition: width .3s ease;\n    '
  track.appendChild(bar)
  const closeButton = document.createElement('button')
  closeButton.textContent = '×'
  closeButton.style.cssText = `
        width: 18px;
        height: 18px;
        border: none;
        background: transparent;
        color: rgba(0, 0, 0, .35);
        cursor: pointer;
        padding: 0;
        border-radius: 4px;
        font-size: 16px;
        line-height: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background .2s, color .2s;
        flex: 0 0 auto;
    `
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, .04)'
    closeButton.style.color = 'rgba(0, 0, 0, .88)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'transparent'
    closeButton.style.color = 'rgba(0, 0, 0, .35)'
  })
  toast.appendChild(accent)
  toast.appendChild(messageLabel)
  toast.appendChild(track)
  prepareCommerceCloseButton(closeButton)
  toast.appendChild(closeButton)
  container.appendChild(toast)
  toast.dataset.status = currentStatus
  messageLabel.classList.add('dlc-commerce-status-text')
  activeProgressToast = toast
  const dismiss = () => {
    toast.parentNode && toast.parentNode.removeChild(toast)
    activeProgressToast === toast && (activeProgressToast = null)
    container &&
      container.parentNode &&
      container.children.length === 0 &&
      container.parentNode.removeChild(container)
  }
  closeButton.addEventListener('click', dismiss)
  return {
    update: (nextMessage, nextPercentage, nextStatus) => {
      if (activeProgressToast !== toast || !toast.parentNode) return
      if (nextMessage !== undefined) messageLabel.textContent = nextMessage
      if (nextPercentage !== undefined)
        bar.style.width = Math.max(0, Math.min(100, nextPercentage)) + '%'
      nextStatus &&
        statusColors[nextStatus] &&
        ((toast.dataset.status = nextStatus),
        (accent.style.background = statusColors[nextStatus]),
        (accent.textContent = nextStatus === 'error' ? '!' : nextStatus === 'success' ? '✓' : 'i'),
        (bar.style.background = statusColors[nextStatus]))
    },
    dismiss: dismiss,
  }
}
function openDouyinVideoDetail(video) {
  const videoId = video?.video_id || video?.videoId || null
  videoId
    ? (console.log('✅ 弹框视频卡片点击跳转:', videoId),
      window.open('https://www.douyin.com/video/' + videoId, '_blank'))
    : showToast('未找到对应的抖音视频链接')
}
function getProductDetailUrl(product) {
  if (!product || !product.id) return ''
  return (
    'https://haohuo.jinritemai.com/ecommerce/trade/detail/index.html?id=' +
    encodeURIComponent(product.id) +
    '&origin_type=pc_compass_manage'
  )
}
function openProductDetail(product) {
  const detailUrl = getProductDetailUrl(product)
  if (!detailUrl) {
    showToast('缺少商品ID，无法跳转商品详情')
    return
  }
  console.log('✅ 跳转商品详情:', detailUrl)
  window.open(detailUrl, '_blank')
}
hookRankApiXhr()
hookFetchDebug()
let clickBindingInterval = setInterval(function () {
    document.body &&
      (clearInterval(clickBindingInterval),
      !window.location.hostname.startsWith('buyin.') && bindVideoCardClickHandlers())
  }, 1000),
  downloadButtonRenderInterval = setInterval(function () {
    document.body && (clearInterval(downloadButtonRenderInterval), renderDownloadFloatingButton())
  }, 1000)
function renderDownloadFloatingButton() {
  ensureAntdComponentStyles()
  if (document.getElementById('xm-download-badge')) {
    updateBadgeCount()
    return
  }
  const badge = document.createElement('div')
  badge.id = 'xm-download-badge'
  badge.innerHTML = `
      <svg width="10" height="16" viewBox="0 0 10 16" fill="currentColor" style="flex:0 0 auto;opacity:.65;">
        <circle cx="2" cy="2" r="1.6"/><circle cx="8" cy="2" r="1.6"/>
        <circle cx="2" cy="8" r="1.6"/><circle cx="8" cy="8" r="1.6"/>
        <circle cx="2" cy="14" r="1.6"/><circle cx="8" cy="14" r="1.6"/>
      </svg>
      <span style="font-weight:500;">已获取到</span>
      <span class="xm-badge-count" style="font-weight:700;">0</span>
      <span style="font-weight:500;">个视频</span>
    `
  badge.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 20px;
      background: #0052D9;
      color: #fff;
      border-radius: 22px;
      font-size: 15px;
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
      box-shadow: 0 6px 18px rgba(22, 119, 255, .32);
      transition: background .2s, box-shadow .2s, transform .2s;
      line-height: 1;
      white-space: nowrap;
      display: none;
    `
  let dragging = false,
    didDrag = false,
    startX = 0,
    startY = 0,
    startLeft = 0,
    startTop = 0
  badge.addEventListener('mousedown', function (event) {
    dragging = true
    didDrag = false
    startX = event.clientX
    startY = event.clientY
    const bounds = badge.getBoundingClientRect()
    startLeft = bounds.left
    startTop = bounds.top
    badge.style.cursor = 'grabbing'
    badge.style.transition = 'none'
    event.preventDefault()
  })
  document.addEventListener('mousemove', function (event) {
    if (!dragging) return
    const deltaX = event.clientX - startX,
      deltaY = event.clientY - startY
    if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) didDrag = true
    if (!didDrag) return
    let left = startLeft + deltaX,
      top = startTop + deltaY
    const width = badge.offsetWidth,
      height = badge.offsetHeight
    left = Math.max(2, Math.min(window.innerWidth - width - 2, left))
    top = Math.max(2, Math.min(window.innerHeight - height - 2, top))
    badge.style.left = left + 'px'
    badge.style.top = top + 'px'
    badge.style.transform = 'none'
  })
  document.addEventListener('mouseup', function () {
    if (!dragging) return
    dragging = false
    badge.style.cursor = 'grab'
    badge.style.transition = 'background .2s, box-shadow .2s, transform .2s'
  })
  badge.addEventListener('mouseenter', function () {
    if (!dragging) badge.style.background = '#366EF4'
  })
  badge.addEventListener('mouseleave', function () {
    if (!dragging) badge.style.background = '#0052D9'
  })
  badge.addEventListener('click', function () {
    if (didDrag) {
      didDrag = false
      return
    }
    showVideoDownloadModal()
  })
  document.body.appendChild(badge)
  updateBadgeCount()
  setInterval(updateBadgeCount, 2000)
  prepareCommerceBadge(badge)
  return badge
}
function formatWanCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return value || '-'
  if (number === 0) return '0'
  if (number >= 100000000) return (number / 100000000).toFixed(2).replace(/\.00$/, '') + '亿'
  if (number >= 10000) return (number / 10000).toFixed(2).replace(/\.00$/, '') + '万'
  return number.toLocaleString()
}
function formatNumber(value) {
  return formatWanCount(value)
}
function formatRangeValue(metric) {
  if (!metric || !Array.isArray(metric.value_range) || metric.value_range.length === 0) return ''
  const unit = metric.value_range[0].unit,
    values = metric.value_range
      .map((entry) => entry.value)
      .filter((value) => typeof value === 'number')
  if (values.length === 0) return ''
  const formatValue = (value) => {
      if (unit === 'price') {
        const amount = value / 100
        if (amount >= 100000000) return (amount / 100000000).toFixed(2).replace(/\.00$/, '') + '亿'
        if (amount >= 10000) return (amount / 10000).toFixed(2).replace(/\.00$/, '') + '万'
        return amount.toLocaleString()
      }
      if (value >= 100000000) return (value / 100000000).toFixed(2).replace(/\.00$/, '') + '亿'
      if (value >= 10000) return (value / 10000).toFixed(2).replace(/\.00$/, '') + '万'
      return value.toLocaleString()
    },
    currencyPrefix = unit === 'price' ? '¥' : ''
  return values
    .map(formatValue)
    .map((formattedValue) => currencyPrefix + formattedValue)
    .join('-')
}
function formatPublishTime(timestamp) {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const date = new Date(seconds * 1000),
    year = date.getFullYear(),
    month = String(date.getMonth() + 1).padStart(2, '0'),
    day = String(date.getDate()).padStart(2, '0')
  return year + '/' + month + '/' + day
}
function formatCompetePublishTime(timestamp) {
  const seconds = Number(timestamp)
  if (!Number.isFinite(seconds) || seconds <= 0) return ''
  const date = new Date(seconds * 1000),
    month = String(date.getMonth() + 1).padStart(2, '0'),
    day = String(date.getDate()).padStart(2, '0'),
    hours = String(date.getHours()).padStart(2, '0'),
    minutes = String(date.getMinutes()).padStart(2, '0')
  return month + '/' + day + ' ' + hours + ':' + minutes
}
function formatCompeteMetric(metric) {
  if (!metric) return '-'
  const lower = metric.extra_value?.lower?.value,
    upper = metric.extra_value?.upper?.value,
    unit = metric.extra_value?.lower?.unit || metric.value?.unit,
    formatRatio = (ratio) => {
      const percentage = ratio * 100
      if (Number.isInteger(percentage)) return percentage + '%'
      return percentage.toFixed(2).replace(/\.?0+$/, '') + '%'
    },
    formatValue = (value2) => {
      if (unit === 'price') {
        const amount = value2 / 100
        if (amount >= 10000) return (amount / 10000).toFixed(2).replace(/\.00$/, '') + '万'
        return amount.toLocaleString()
      }
      return value2.toLocaleString()
    },
    currencyPrefix = unit === 'price' ? '¥' : ''
  if (typeof lower === 'number' && typeof upper === 'number') {
    if (unit === 'ratio') return formatRatio(lower) + '-' + formatRatio(upper)
    return currencyPrefix + formatValue(lower) + '-' + currencyPrefix + formatValue(upper)
  }
  const value = metric.value?.value
  if (typeof value === 'number') {
    if (unit === 'ratio') return formatRatio(value)
    return currencyPrefix + formatValue(value)
  }
  return '-'
}
function createStatColumn(label, value) {
  const column = document.createElement('div')
  column.style.cssText = `
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 80px;
    flex: 1 1 0;
  `
  const labelNode = document.createElement('div')
  labelNode.textContent = label
  labelNode.style.cssText = `
    color: rgba(0,0,0,.45);
    font-size: 12px;
    line-height: 1.4;
    margin-bottom: 4px;
    white-space: nowrap;
  `
  const valueNode = document.createElement('div')
  valueNode.textContent = value || '-'
  valueNode.style.cssText = `
    color: rgba(0,0,0,.88);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  `
  column.appendChild(labelNode)
  column.appendChild(valueNode)
  return column
}
function createModalRow(row, rowIndex, genericMode, productMode, competeVideoMode) {
  const isProduct = productMode,
    isCompeteVideo = !isProduct && competeVideoMode,
    isGeneric = !isProduct && !isCompeteVideo && genericMode,
    card = document.createElement('div')
  card.classList.add('dlc-commerce-row')
  card.style.cssText = `
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px;
    border: 1px solid #F3F3F3;
    border-radius: 8px;
    margin-bottom: 12px;
    background: #fff;
    transition: all .2s;
    box-sizing: border-box;
  `
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'product-checkbox xm-ant-checkbox'
  checkbox.dataset.productIndex = String(rowIndex)
  checkbox.checked = row.checked
  if (isCompeteVideo) {
    const extraMetrics = row.extra || {},
      firstVideo = (row.videos && row.videos[0]) || {},
      cover = document.createElement('img')
    cover.src = firstVideo.video_img || row.imgUrl || ''
    cover.style.cssText = `
      width: 56px;
      height: 100px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #F3F3F3;
      flex: 0 0 auto;
      cursor: pointer;
    `
    cover.addEventListener('click', (event) => {
      event.stopPropagation()
      openDouyinVideoDetail(firstVideo)
    })
    const videoInfo = document.createElement('div')
    videoInfo.style.cssText = `
      flex: 1 1 200px;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 4px;
    `
    const videoTitle = document.createElement('div')
    videoTitle.textContent = firstVideo.video_name || row.name || ''
    videoTitle.style.cssText = `
      color: rgba(0, 0, 0, .88);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      word-break: break-word;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      cursor: pointer;
    `
    videoTitle.addEventListener('click', (event) => {
      event.stopPropagation()
      openDouyinVideoDetail(firstVideo)
    })
    const authorLabel = document.createElement('div')
    authorLabel.textContent = (row.name || '未知用户') + (row.id ? ' (ID: ' + row.id + ')' : '')
    authorLabel.title = '作者ID: ' + (row.id || '')
    authorLabel.style.cssText = `
      color: rgba(0, 0, 0, .65);
      font-size: 13px;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `
    const publishLabel = document.createElement('div')
    publishLabel.textContent = extraMetrics.publishTime
      ? '发布时间 ' + extraMetrics.publishTime
      : ''
    publishLabel.style.cssText = `
      color: rgba(0, 0, 0, .45);
      font-size: 12px;
      line-height: 1.4;
    `
    const engagementMetrics = document.createElement('div')
    engagementMetrics.style.cssText = `
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
      margin-top: 2px;
    `
    const appendMetric = (label, value) => {
      if (value === undefined || value === null || value === '') return
      const metricLabel = document.createElement('span')
      metricLabel.textContent = label + ' ' + value
      metricLabel.style.cssText = 'color: rgba(0, 0, 0, .45); font-size: 12px;'
      engagementMetrics.appendChild(metricLabel)
    }
    if (extraMetrics.watchCnt) appendMetric('播放', Number(extraMetrics.watchCnt).toLocaleString())
    if (extraMetrics.commentCnt)
      appendMetric('评论', Number(extraMetrics.commentCnt).toLocaleString())
    if (extraMetrics.finishWatchRatio)
      appendMetric('完播率', (extraMetrics.finishWatchRatio * 100).toFixed(1) + '%')
    videoInfo.appendChild(videoTitle)
    videoInfo.appendChild(authorLabel)
    videoInfo.appendChild(publishLabel)
    if (engagementMetrics.children.length) videoInfo.appendChild(engagementMetrics)
    const salesMetrics = document.createElement('div')
    salesMetrics.style.cssText = `
      display: flex;
      align-items: center;
      gap: 18px;
      flex: 0 0 auto;
      flex-wrap: wrap;
    `
    salesMetrics.appendChild(createStatColumn('支付金额', extraMetrics.payAmt))
    salesMetrics.appendChild(createStatColumn('成交人数', extraMetrics.payUcnt))
    salesMetrics.appendChild(createStatColumn('点击率', extraMetrics.dhProductClickRatioUv))
    salesMetrics.appendChild(createStatColumn('成交订单', extraMetrics.payCnt))
    salesMetrics.appendChild(createStatColumn('成交件数', extraMetrics.payComboCnt))
    card.appendChild(checkbox)
    card.appendChild(cover)
    card.appendChild(videoInfo)
    card.appendChild(salesMetrics)
    layoutCommerceGroup(card, checkbox, [authorLabel], salesMetrics, [cover, videoInfo], row)
  } else if (!isGeneric) {
    const avatar = document.createElement('img')
    avatar.src = row.imgUrl || ''
    avatar.className = 'product-avatar'
    avatar.style.cssText =
      `
      width: 36px;
      height: 36px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #F3F3F3;
      flex: 0 0 auto;
      ` +
      (productMode && row.id ? 'cursor: pointer;' : '') +
      '\n    '
    productMode &&
      row.id &&
      avatar.addEventListener('click', (event) => {
        event.stopPropagation()
        openProductDetail(row)
      })
    const identity = document.createElement('div')
    identity.style.cssText = '\n      flex: 1 1 176px;\n      min-width: 176px;\n    '
    const title = document.createElement('div')
    title.textContent = row.name || '未知产品'
    title.style.cssText =
      `
      color: rgba(0, 0, 0, .88);
      font-size: 14px;
      font-weight: 600;
      margin-bottom: 4px;
      word-break: break-word;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      ` +
      (productMode && row.id ? 'cursor: pointer;' : '') +
      '\n    '
    productMode &&
      row.id &&
      title.addEventListener('click', (event) => {
        event.stopPropagation()
        openProductDetail(row)
      })
    identity.appendChild(title)
    if (productMode && row.shopName) {
      const shopLabel = document.createElement('div')
      shopLabel.textContent = '店铺: ' + row.shopName
      shopLabel.style.cssText = `
        color: rgba(0, 0, 0, .45);
        font-size: 13px;
        line-height: 1.4;
      `
      identity.appendChild(shopLabel)
    }
    if (row.rank) {
      const rankLabel = document.createElement('div')
      rankLabel.textContent = '排名: ' + row.rank
      rankLabel.style.cssText = `
        color: rgba(0, 0, 0, .45);
        font-size: 13px;
        line-height: 1.4;
      `
      identity.appendChild(rankLabel)
    }
    if (isProduct && row.extra && row.extra.priceBin) {
      const priceLabel = document.createElement('div')
      priceLabel.textContent = '价格带: ' + row.extra.priceBin
      priceLabel.style.cssText = `
        color: rgba(0, 0, 0, .45);
        font-size: 13px;
        line-height: 1.4;
      `
      identity.appendChild(priceLabel)
    }
    const videoSection = document.createElement('div')
    videoSection.style.cssText = `
      display: flex;
      flex: 0 1 auto;
      gap: 8px;
      flex-wrap: nowrap;
      align-items: center;
      justify-content: flex-start;
      min-width: 0;
      overflow: hidden;
    `
    if (row.videos && row.videos.length > 0) {
      const previewLimit = isProduct ? 4 : 5,
        previewVideos = row.videos.slice(0, previewLimit),
        hasMoreVideos = row.videos.length > previewLimit
      previewVideos.forEach((video, videoIndex) => {
        const thumbnail = document.createElement('div')
        thumbnail.style.cssText = `
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 5px;
          position: relative;
          cursor: pointer;
          width: 56px;
          height: 100px;
          flex: 0 0 auto;
        `
        const videoCheckbox = document.createElement('input')
        videoCheckbox.type = 'checkbox'
        videoCheckbox.className = 'video-checkbox xm-ant-checkbox xm-video-thumb-checkbox'
        videoCheckbox.dataset.productIndex = String(rowIndex)
        videoCheckbox.dataset.videoIndex = String(videoIndex)
        videoCheckbox.checked = row.videos[videoIndex].checked
        videoCheckbox.addEventListener('change', () => {
          setVideoChecked(rowIndex, videoIndex, videoCheckbox.checked)
        })
        const cover = document.createElement('img')
        cover.src = video.video_img || ''
        cover.className = 'video-thumbnail'
        cover.style.cssText = `
          width: 56px;
          height: 100px;
          border-radius: 6px;
          object-fit: cover;
          border: 1px solid #F3F3F3;
          transition: border-color .2s;
          flex: 0 0 auto;
        `
        cover.addEventListener('mouseenter', () => {
          cover.style.borderColor = '#0052D9'
        })
        cover.addEventListener('mouseleave', () => {
          cover.style.borderColor = '#F3F3F3'
        })
        thumbnail.addEventListener('click', (event) => {
          if (event.target === videoCheckbox) return
          event.stopPropagation()
          openDouyinVideoDetail(video)
        })
        thumbnail.appendChild(videoCheckbox)
        thumbnail.appendChild(cover)
        videoSection.appendChild(thumbnail)
      })
      if (hasMoreVideos) {
        const moreButton = document.createElement('div')
        moreButton.textContent = '⋮'
        moreButton.title = '查看更多视频'
        moreButton.setAttribute('role', 'button')
        moreButton.setAttribute('aria-label', '查看更多视频')
        moreButton.style.cssText = `
          width: 34px;
          height: 100px;
          background: #E8F0FE;
          color: #0052D9;
          border: 1px solid #8FBEF7;
          padding: 0;
          border-radius: 8px;
          cursor: pointer;
          font-size: 28px;
          font-weight: 700;
          line-height: 1;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: all .2s;
          user-select: none;
          white-space: nowrap;
          box-sizing: border-box;
          flex: 0 0 34px;
          box-shadow: 0 4px 10px rgba(22, 119, 255, .10);
        `
        moreButton.addEventListener('mouseenter', () => {
          moreButton.style.background = '#D6E7FF'
          moreButton.style.borderColor = '#69b1ff'
          moreButton.style.boxShadow = '0 6px 14px rgba(22, 119, 255, .16)'
        })
        moreButton.addEventListener('mouseleave', () => {
          moreButton.style.background = '#E8F0FE'
          moreButton.style.borderColor = '#8FBEF7'
          moreButton.style.boxShadow = '0 4px 10px rgba(22, 119, 255, .10)'
        })
        moreButton.addEventListener('click', (event) => {
          event.stopPropagation()
          showMoreVideosModal(row, rowIndex, productMode)
        })
        videoSection.appendChild(moreButton)
      }
    } else {
      const authorCard = document.createElement('div')
      authorCard.textContent = '该产品暂无视频'
      authorCard.style.cssText = `
        color: rgba(0, 0, 0, .45);
        font-size: 14px;
        line-height: 1.5;
      `
      videoSection.appendChild(authorCard)
    }
    let metrics = null
    if (isProduct && row.extra) {
      metrics = document.createElement('div')
      metrics.style.cssText = `
        display: flex;
        align-items: center;
        gap: 20px;
        flex: 0 0 auto;
      `
      metrics.appendChild(createStatColumn('支付金额', row.extra.payAmt))
      metrics.appendChild(createStatColumn('点击次数', row.extra.productClickCnt))
      metrics.appendChild(createStatColumn('成交件数', row.extra.payComboCnt))
      metrics.appendChild(createStatColumn('视频数量', row.extra.videoCnt))
    }
    card.appendChild(checkbox)
    card.appendChild(avatar)
    card.appendChild(identity)
    if (metrics) card.appendChild(metrics)
    card.appendChild(videoSection)
    videoSection.classList.add('dlc-commerce-thumbnails')
    layoutCommerceGroup(card, checkbox, [avatar, identity], metrics, [videoSection], row)
  } else {
    const extraMetrics = row.extra || {},
      firstVideo = (row.videos && row.videos[0]) || {},
      videoContainer = document.createElement('div')
    videoContainer.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 0 0 200px;
      min-width: 0;
    `
    const avatar = document.createElement('img')
    avatar.src = row.imgUrl || ''
    avatar.className = 'product-avatar'
    avatar.style.cssText = `
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid #F3F3F3;
      flex: 0 0 auto;
    `
    const authorInfo = document.createElement('div')
    authorInfo.style.cssText = `
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      flex: 1;
    `
    const authorName = document.createElement('div')
    authorName.textContent = row.name || '未知达人'
    authorName.style.cssText = `
      color: rgba(0,0,0,.88);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-bottom: 4px;
    `
    const authorMeta = document.createElement('div')
    authorMeta.style.cssText = `
      color: rgba(0,0,0,.45);
      font-size: 12px;
      line-height: 1.4;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    `
    const fansCount = Number(extraMetrics.author_fans_count) || 0,
      resident = extraMetrics.author_resident || ''
    let fansLabel = fansCount > 0 ? '粉丝数 ' + fansCount.toLocaleString() : ''
    if (resident) fansLabel += (fansLabel ? ' · ' : '') + resident
    authorMeta.textContent = fansLabel || ' '
    authorInfo.appendChild(authorName)
    authorInfo.appendChild(authorMeta)
    const levelLabel = document.createElement('div')
    levelLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 4px;
    `
    const authorLevel = extraMetrics.author_level
    if (authorLevel !== undefined && authorLevel !== null && authorLevel !== '') {
      const levelBadge = document.createElement('span')
      levelBadge.textContent = 'LV' + authorLevel
      levelBadge.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 1px 6px;
        background: #f2f3f5;
        color: rgba(0,0,0,.6);
        font-size: 11px;
        line-height: 1.4;
        border-radius: 4px;
        font-weight: 500;
      `
      levelLabel.appendChild(levelBadge)
    }
    if (extraMetrics.is_self_sale) {
      const sellerBadge = document.createElement('span')
      sellerBadge.textContent = '商家自卖'
      sellerBadge.style.cssText = `
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 1px 6px;
        background: #fff0f0;
        color: #e34d59;
        font-size: 11px;
        line-height: 1.4;
        border-radius: 4px;
        font-weight: 500;
      `
      levelLabel.appendChild(sellerBadge)
    }
    authorInfo.appendChild(levelLabel)
    videoContainer.appendChild(avatar)
    videoContainer.appendChild(authorInfo)
    const salesMetrics = document.createElement('div')
    salesMetrics.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1 1 260px;
      min-width: 0;
    `
    const thumbnail = document.createElement('div')
    thumbnail.style.cssText = `
      position: relative;
      width: 56px;
      height: 100px;
      flex: 0 0 auto;
      cursor: pointer;
    `
    const videoCheckbox = document.createElement('input')
    videoCheckbox.type = 'checkbox'
    videoCheckbox.className = 'video-checkbox xm-ant-checkbox xm-video-thumb-checkbox'
    videoCheckbox.dataset.productIndex = String(rowIndex)
    videoCheckbox.dataset.videoIndex = '0'
    videoCheckbox.checked = !!firstVideo.checked
    videoCheckbox.addEventListener('change', () => {
      setVideoChecked(rowIndex, 0, videoCheckbox.checked)
    })
    const cover = document.createElement('img')
    cover.src = firstVideo.video_img || ''
    cover.className = 'video-thumbnail'
    cover.style.cssText = `
      width: 56px;
      height: 100px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid #F3F3F3;
      transition: border-color .2s;
    `
    cover.addEventListener('mouseenter', () => {
      cover.style.borderColor = '#0052D9'
    })
    cover.addEventListener('mouseleave', () => {
      cover.style.borderColor = '#F3F3F3'
    })
    thumbnail.addEventListener('click', (event) => {
      if (event.target === videoCheckbox) return
      event.stopPropagation()
      openDouyinVideoDetail(firstVideo)
    })
    thumbnail.appendChild(videoCheckbox)
    thumbnail.appendChild(cover)
    const videoDetails = document.createElement('div')
    videoDetails.style.cssText = `
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      flex: 1;
    `
    const videoTitle = document.createElement('div')
    videoTitle.textContent = firstVideo.video_name || '未知视频'
    videoTitle.style.cssText = `
      color: rgba(0,0,0,.88);
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      margin-bottom: 6px;
    `
    const videoStats = document.createElement('div')
    videoStats.textContent = '视频发布时间 ' + formatPublishTime(extraMetrics.publish_time)
    videoStats.style.cssText = `
      color: rgba(0,0,0,.45);
      font-size: 12px;
      line-height: 1.4;
    `
    videoDetails.appendChild(videoTitle)
    videoDetails.appendChild(videoStats)
    salesMetrics.appendChild(thumbnail)
    salesMetrics.appendChild(videoDetails)
    const videoMetrics = document.createElement('div')
    videoMetrics.style.cssText = `
      display: flex;
      align-items: stretch;
      gap: 4px;
      flex: 0 0 320px;
      min-width: 0;
    `
    videoMetrics.appendChild(createStatColumn('销量', extraMetrics.format_sales || '-'))
    videoMetrics.appendChild(createStatColumn('结算金额', extraMetrics.format_sales_amount || '-'))
    videoMetrics.appendChild(createStatColumn('播放量', formatWanCount(extraMetrics.play_count)))
    videoMetrics.appendChild(createStatColumn('点赞数', formatWanCount(extraMetrics.like_count)))
    card.appendChild(checkbox)
    card.appendChild(videoContainer)
    card.appendChild(salesMetrics)
    card.appendChild(videoMetrics)
    layoutCommerceGroup(card, checkbox, [videoContainer], videoMetrics, [salesMetrics], row)
  }
  setProductCardSelectedStyle(card, checkbox.checked)
  return card
}
function showVideoDownloadModal() {
  const commerceEvents = new AbortController()
  ensureAntdComponentStyles()
  genericRankList.length > 0 &&
    genericRankList.forEach((row) => {
      const videoIds = (row.videos || []).map((video) => video.video_id).filter(Boolean)
      if (videoIds.length === 0) return
      const allVideosSeen = videoIds.every((videoId) => rankVideoIdSet.has(String(videoId)))
      if (allVideosSeen) return
      videoIds.forEach((videoId) => rankVideoIdSet.add(String(videoId)))
      rankList.push(row)
    })
  if (rankList.length === 0) {
    showToast('暂无视频数据可下载')
    return
  }
  const isCompeteProduct = lastInterceptedApi === 'competeProductDetail',
    isProductRank = lastInterceptedApi === 'shopProductVideoRank',
    isGeneric = lastInterceptedApi === 'generic'
  console.log(
    '[XM-DEBUG] isPackDetail=',
    isGeneric,
    'isMerchandiseProductRank=',
    isProductRank,
    'isCompeteProductDetail=',
    isCompeteProduct,
    'lastInterceptedApi=',
    lastInterceptedApi,
    'rankList=',
    rankList.length,
  )
  const overlay = document.createElement('div')
  overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, .45);
        z-index: 10001;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 64px 24px 24px;
        box-sizing: border-box;
    `
  const panel = document.createElement('div')
  panel.style.cssText =
    '\n        width: ' +
    (isGeneric || isProductRank || isCompeteProduct
      ? 'min(1100px, calc(100vw - 48px))'
      : 'min(760px, calc(100vw - 48px))') +
    `;
        max-height: calc(100vh - 88px);
        overflow-y: auto;
        position: relative;
        background: #fff;
        border-radius: 8px;
        padding: 20px 24px 24px;
        box-shadow: 0 6px 16px 0 rgba(0, 0, 0, .08), 0 3px 6px -4px rgba(0, 0, 0, .12), 0 9px 28px 8px rgba(0, 0, 0, .05);
        box-sizing: border-box;
    `
  const header = document.createElement('div')
  header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: -2px 0 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #F3F3F3;
    `
  const title = document.createElement('h2')
  title.textContent = '视频复制列表'
  title.style.cssText = `
        margin: 0;
        color: rgba(0, 0, 0, .88);
        font-size: 16px;
        font-weight: 600;
        line-height: 1.5;
    `
  const closeButton = document.createElement('button')
  closeButton.textContent = '×'
  closeButton.style.cssText = `
        background: transparent;
        border: none;
        font-size: 22px;
        cursor: pointer;
        color: rgba(0, 0, 0, .45);
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        transition: background .2s, color .2s;
    `
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, .04)'
    closeButton.style.color = 'rgba(0, 0, 0, .88)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'transparent'
    closeButton.style.color = 'rgba(0, 0, 0, .45)'
  })
  closeButton.addEventListener('click', () => {
    commerceEvents.abort()
    document.body.removeChild(overlay)
  })
  header.appendChild(title)
  let filteredRows = []
  const totalCount = document.createElement('span')
  totalCount.style.cssText = `
        margin-left: 8px;
        padding: 2px 10px;
        background: #EBF0FF;
        color: #0052D9;
        font-size: 12px;
        font-weight: 500;
        border-radius: 10px;
        line-height: 1.5;
        white-space: nowrap;
    `
  header.appendChild(totalCount)
  const copiedCount = document.createElement('span')
  copiedCount.style.cssText = `
        margin-left: 8px;
        padding: 2px 10px;
        background: #FFF7E8;
        color: #D48806;
        font-size: 12px;
        font-weight: 500;
        border-radius: 10px;
        line-height: 1.5;
        white-space: nowrap;
    `
  header.appendChild(copiedCount)
  function refreshCounts() {
    let total = 0
    for (const { param } of filteredRows) total += (param.videos || []).length
    totalCount.textContent = `共 ${total} 条`
    refreshCommerceSelectionActions()
  }
  header.appendChild(closeButton)
  const filters = document.createElement('div')
  filters.style.cssText = `
        margin-bottom: 12px;
        padding: 12px 16px;
        background: #fafafa;
        border: 1px solid #F3F3F3;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
    `
  const selectAll = document.createElement('input')
  selectAll.type = 'checkbox'
  selectAll.id = 'selectAll'
  selectAll.className = 'xm-ant-checkbox'
  const selectAllLabel = document.createElement('label')
  selectAllLabel.htmlFor = 'selectAll'
  selectAllLabel.textContent = '全选'
  selectAllLabel.style.cssText = `
        color: rgba(0, 0, 0, .88);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        user-select: none;
    `
  let filterControl
  if (isProductRank) {
    filterControl = document.createElement('input')
    filterControl.type = 'text'
    filterControl.placeholder = '搜索商品标题'
    filterControl.value = ''
    filterControl.style.cssText = `
        height: 32px;
        padding: 0 10px;
        border: 1px solid #DCDCDC;
        border-radius: 6px;
        font-size: 13px;
        color: rgba(0, 0, 0, .88);
        background: #fff;
        flex: 1;
        max-width: 240px;
        margin-right: auto;
        outline: none;
        transition: border-color .2s;
    `
    filterControl.addEventListener('input', () => {
      currentPage = 1
      renderRows(filterControl.value)
    })
  } else {
    const authors = new Map()
    rankList.forEach((row) => {
      const authorKey = String(row.id || row.name || '')
      authorKey &&
        !authors.has(authorKey) &&
        authors.set(authorKey, {
          name: row.name || '未知达人',
          id: row.id || '',
        })
      ;(row.videos || []).forEach((video) => {
        const authorKey2 = String(video.author_id || video.author_name || '')
        authorKey2 &&
          !authors.has(authorKey2) &&
          authors.set(authorKey2, {
            name: video.author_name || '未知达人',
            id: video.author_id || '',
          })
      })
    })
    const sortedAuthors = Array.from(authors.entries()).sort((leftAuthor, rightAuthor) =>
      leftAuthor[1].name.localeCompare(rightAuthor[1].name, 'zh-CN'),
    )
    filterControl = document.createElement('select')
    filterControl.style.cssText = `
        height: 32px;
        padding: 0 10px;
        padding-right: 28px;
        border: 1px solid #DCDCDC;
        border-radius: 6px;
        font-size: 13px;
        color: rgba(0, 0, 0, .88);
        background: #fff;
        flex: 1;
        max-width: 240px;
        margin-right: auto;
        outline: none;
        transition: border-color .2s;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23999999'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
    `
    const allAuthorsOption = document.createElement('option')
    allAuthorsOption.value = ''
    allAuthorsOption.textContent = '全部达人'
    filterControl.appendChild(allAuthorsOption)
    sortedAuthors.forEach(([authorKey, author]) => {
      const option = document.createElement('option')
      option.value = authorKey
      option.textContent = author.name
      filterControl.appendChild(option)
    })
  }
  filterControl.addEventListener('focus', () => {
    filterControl.style.borderColor = '#0052D9'
  })
  filterControl.addEventListener('blur', () => {
    filterControl.style.borderColor = '#DCDCDC'
  })
  const clearButton = document.createElement('button')
  clearButton.textContent = '清空'
  clearButton.style.cssText = `
        height: 32px;
        background: #fff;
        color: rgba(0, 0, 0, .65);
        border: 1px solid #DCDCDC;
        padding: 4px 15px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5715;
        transition: all .2s;
    `
  clearButton.addEventListener('mouseenter', () => {
    clearButton.style.color = '#D54941'
    clearButton.style.borderColor = '#D54941'
  })
  clearButton.addEventListener('mouseleave', () => {
    clearButton.style.color = 'rgba(0, 0, 0, .65)'
    clearButton.style.borderColor = '#DCDCDC'
  })
  clearButton.addEventListener('click', () => {
    rankList = []
    genericRankList = []
    rankVideoIdSet.clear()
    genericVideoIdSet.clear()
    filterControl.value = ''
    currentPage = 1
    filteredRows = []
    list.innerHTML = ''
    const emptyState = document.createElement('div')
    emptyState.textContent = '暂无数据，已清空全部抓取结果'
    emptyState.style.cssText = `
        padding: 48px 0;
        text-align: center;
        color: rgba(0, 0, 0, .45);
        font-size: 14px;
    `
    list.appendChild(emptyState)
    renderPagination()
    selectAll.checked = false
    selectAll.indeterminate = false
    updateBadgeCount()
    refreshCounts()
    showToast('已清空全部抓取数据')
  })
  const primaryButtonStyle = `
        height: 32px;
        background: #0052D9;
        color: #fff;
        border: 1px solid #0052D9;
        padding: 4px 15px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 400;
        line-height: 1.5715;
        transition: all .2s;
    `,
    bindButtonHover = (button) => {
      button.addEventListener('mouseenter', () => {
        button.style.background = '#366EF4'
        button.style.borderColor = '#366EF4'
      })
      button.addEventListener('mouseleave', () => {
        button.style.background = '#0052D9'
        button.style.borderColor = '#0052D9'
      })
    },
    copyPageButton = document.createElement('button')
  copyPageButton.textContent = '复制当前页'
  copyPageButton.style.cssText = primaryButtonStyle
  bindButtonHover(copyPageButton)
  const copyAllButton = document.createElement('button')
  copyAllButton.textContent = '复制全部'
  copyAllButton.style.cssText = primaryButtonStyle
  bindButtonHover(copyAllButton)
  const copySelectedButton = document.createElement('button')
  copySelectedButton.textContent = '复制选中'
  copySelectedButton.style.cssText = primaryButtonStyle
  bindButtonHover(copySelectedButton)
  const downloadSelectedButton = document.createElement('button')
  downloadSelectedButton.textContent = '下载选中'
  downloadSelectedButton.style.cssText = primaryButtonStyle
  bindButtonHover(downloadSelectedButton)
  filters.appendChild(selectAll)
  filters.appendChild(selectAllLabel)
  filters.appendChild(filterControl)
  filters.appendChild(clearButton)
  filters.appendChild(copyPageButton)
  filters.appendChild(copyAllButton)
  filters.appendChild(copySelectedButton)
  filters.appendChild(downloadSelectedButton)
  const list = document.createElement('div')
  let currentPage = 1,
    pageSize = 10
  function filterRows(filterValue) {
    const query = String(filterValue || '').trim(),
      matchingRows = []
    rankList.forEach((row, rowIndex) => {
      if (query) {
        if (isProductRank) {
          const title2 = String(row.name || '').toLowerCase()
          if (!title2.includes(query.toLowerCase())) return
        } else {
          const authorKey = String(row.id || row.name || ''),
            videoAuthorKeys = (row.videos || []).map((video) =>
              String(video.author_id || video.author_name || ''),
            )
          if (authorKey !== query && !videoAuthorKeys.includes(query)) return
        }
      }
      matchingRows.push({
        param: row,
        originalIdx: rowIndex,
      })
    })
    return matchingRows
  }
  function renderRows(filterValue) {
    filteredRows = filterRows(filterValue)
    const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize))
    if (currentPage > pageCount) currentPage = pageCount
    if (currentPage < 1) currentPage = 1
    list.innerHTML = ''
    const startIndex = (currentPage - 1) * pageSize,
      endIndex = Math.min(startIndex + pageSize, filteredRows.length)
    let renderedCount = 0
    for (let index = startIndex; index < endIndex; index++) {
      const { param: row, originalIdx: rowIndex } = filteredRows[index]
      list.appendChild(createModalRow(row, rowIndex, isGeneric, isProductRank, isCompeteProduct))
      renderedCount++
    }
    if (renderedCount === 0) {
      const emptyState = document.createElement('div')
      emptyState.textContent = String(filterValue || '').trim()
        ? isProductRank
          ? '没有匹配的商品'
          : '没有匹配的达人'
        : '暂无数据'
      emptyState.style.cssText = `
          padding: 48px 0;
          text-align: center;
          color: rgba(0, 0, 0, .45);
          font-size: 14px;
      `
      list.appendChild(emptyState)
    }
    renderPagination()
    refreshCounts()
  }
  const pagination = document.createElement('div')
  pagination.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 12px;
        margin-top: 12px;
        padding: 8px 0;
        font-size: 13px;
        color: rgba(0, 0, 0, .65);
        flex-wrap: wrap;
    `
  function renderPagination() {
    pagination.innerHTML = ''
    const totalRows = filteredRows.length,
      pageCount = Math.max(1, Math.ceil(totalRows / pageSize)),
      pageSizeLabel = document.createElement('span')
    pageSizeLabel.textContent = '每页'
    pageSizeLabel.style.whiteSpace = 'nowrap'
    pagination.appendChild(pageSizeLabel)
    const pageSizeSelect = document.createElement('select')
    pageSizeSelect.style.cssText = `
          height: 28px;
          padding: 0 6px;
          padding-right: 22px;
          border: 1px solid #DCDCDC;
          border-radius: 4px;
          font-size: 13px;
          color: rgba(0, 0, 0, .88);
          background: #fff;
          outline: none;
          cursor: pointer;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='%23999999'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 6px center;
      `
    ;[10, 20, 50, 100].forEach((size) => {
      const option = document.createElement('option')
      option.value = String(size)
      option.textContent = String(size)
      if (size === pageSize) option.selected = true
      pageSizeSelect.appendChild(option)
    })
    pageSizeSelect.addEventListener('change', () => {
      pageSize = parseInt(pageSizeSelect.value, 10) || 10
      currentPage = 1
      renderRows(filterControl.value)
    })
    pagination.appendChild(pageSizeSelect)
    const itemsLabel = document.createElement('span')
    itemsLabel.textContent = '条'
    itemsLabel.style.whiteSpace = 'nowrap'
    pagination.appendChild(itemsLabel)
    const separator = document.createElement('span')
    separator.textContent = '|'
    separator.style.color = '#DCDCDC'
    pagination.appendChild(separator)
    const previousButton = document.createElement('button')
    previousButton.textContent = '上一页'
    previousButton.style.cssText = `
          height: 28px;
          padding: 0 12px;
          border: 1px solid #DCDCDC;
          border-radius: 4px;
          background: #fff;
          color: rgba(0, 0, 0, .65);
          cursor: pointer;
          font-size: 13px;
          transition: all .2s;
      `
    currentPage <= 1
      ? ((previousButton.style.opacity = '0.4'), (previousButton.style.cursor = 'not-allowed'))
      : (previousButton.addEventListener('mouseenter', () => {
          previousButton.style.borderColor = '#0052D9'
          previousButton.style.color = '#0052D9'
        }),
        previousButton.addEventListener('mouseleave', () => {
          previousButton.style.borderColor = '#DCDCDC'
          previousButton.style.color = 'rgba(0, 0, 0, .65)'
        }))
    previousButton.addEventListener('click', () => {
      currentPage > 1 && (currentPage--, renderRows(filterControl.value))
    })
    pagination.appendChild(previousButton)
    const pageLabel = document.createElement('span')
    pageLabel.textContent = '第 ' + currentPage + ' / ' + pageCount + ' 页'
    pageLabel.style.whiteSpace = 'nowrap'
    pagination.appendChild(pageLabel)
    const nextButton = document.createElement('button')
    nextButton.textContent = '下一页'
    nextButton.style.cssText = `
          height: 28px;
          padding: 0 12px;
          border: 1px solid #DCDCDC;
          border-radius: 4px;
          background: #fff;
          color: rgba(0, 0, 0, .65);
          cursor: pointer;
          font-size: 13px;
          transition: all .2s;
      `
    currentPage >= pageCount
      ? ((nextButton.style.opacity = '0.4'), (nextButton.style.cursor = 'not-allowed'))
      : (nextButton.addEventListener('mouseenter', () => {
          nextButton.style.borderColor = '#0052D9'
          nextButton.style.color = '#0052D9'
        }),
        nextButton.addEventListener('mouseleave', () => {
          nextButton.style.borderColor = '#DCDCDC'
          nextButton.style.color = 'rgba(0, 0, 0, .65)'
        }))
    nextButton.addEventListener('click', () => {
      currentPage < pageCount && (currentPage++, renderRows(filterControl.value))
    })
    pagination.appendChild(nextButton)
    const separator2 = document.createElement('span')
    separator2.textContent = '|'
    separator2.style.color = '#DCDCDC'
    pagination.appendChild(separator2)
    const totalLabel = document.createElement('span')
    totalLabel.textContent = '共 ' + totalRows + ' 条'
    totalLabel.style.whiteSpace = 'nowrap'
    pagination.appendChild(totalLabel)
  }
  filterControl.addEventListener('change', () => {
    currentPage = 1
    renderRows(filterControl.value)
  })
  renderRows()
  selectAll.addEventListener('change', (event) => {
    const productCheckboxes = document.querySelectorAll('.product-checkbox'),
      videoCheckboxes = document.querySelectorAll('.video-checkbox'),
      modalCheckboxes = document.querySelectorAll('.video-checkbox-modal'),
      checked = event.target.checked
    rankList.forEach((row, video) => {
      row.checked = checked
      Array.isArray(row.videos) &&
        row.videos.forEach((video2) => {
          video2.checked = checked
        })
    })
    productCheckboxes.forEach((checkbox) => {
      checkbox.checked = checked
      checkbox.indeterminate = false
    })
    videoCheckboxes.forEach((checkbox) => {
      checkbox.checked = checked
    })
    modalCheckboxes.forEach((checkbox) => {
      checkbox.checked = event.target.checked
    })
    console.log('🔘 全选状态更新: ' + event.target.checked)
    productCheckboxes.forEach((checkbox) => {
      const card = checkbox.closest('div[style*="display: flex"]')
      card && setProductCardSelectedStyle(card, event.target.checked)
    })
    refreshCounts()
  })
  document.addEventListener(
    'change',
    (event) => {
      if (!event.target.closest('.dlc-commerce-overlay')) return
      if (event.target.classList.contains('product-checkbox')) {
        const rowIndex = parseInt(event.target.dataset.productIndex),
          row = rankList[rowIndex]
        if (!row) {
          console.error('产品索引 ' + rowIndex + ' 不存在')
          return
        }
        const checked = event.target.checked
        row.checked = checked
        Array.isArray(row.videos) &&
          (row.videos.forEach((video, videoIndex) => {
            setVideoChecked(rowIndex, videoIndex, checked, true)
          }),
          updateProductCheckboxState(rowIndex))
        const card = event.target.closest('div[style*="display: flex"]')
        card && setProductCardSelectedStyle(card, checked)
        console.log('🔗 产品联动更新: 产品' + rowIndex + ' = ' + checked)
      }
      ;(event.target.classList.contains('product-checkbox') ||
        event.target.classList.contains('video-checkbox') ||
        event.target.classList.contains('video-checkbox-modal')) &&
        refreshCounts()
    },
    {
      signal: commerceEvents.signal,
    },
  )
  function collectVideoLinks(rows) {
    const links = []
    rows.forEach(({ param: entry }) => {
      ;(entry.videos || []).forEach((video) => {
        video.video_id && links.push('https://www.douyin.com/video/' + video.video_id)
      })
    })
    return links
  }
  function copyLinks(links, scopeLabel) {
    if (links.length === 0) {
      showToast('没有可复制的视频')
      return
    }
    const text = links.join('\n')
    navigator.clipboard
      .writeText(text)
      .then(() => {
        totalCopiedCount += links.length
        showToast(
          '✅ 已复制 ' + links.length + ' 条' + scopeLabel + '（累计 ' + totalCopiedCount + ' 条）',
        )
      })
      ['catch']((copyError) => {
        console.error('复制失败:', copyError)
        showToast('❌ 复制失败，请手动复制')
      })
  }
  copyPageButton.addEventListener('click', () => {
    const startIndex = (currentPage - 1) * pageSize,
      endIndex = Math.min(startIndex + pageSize, filteredRows.length),
      pageRows = filteredRows.slice(startIndex, endIndex)
    copyLinks(collectVideoLinks(pageRows), '（当前页）')
  })
  copyAllButton.addEventListener('click', () => {
    copyLinks(collectVideoLinks(filteredRows), '（全部）')
  })
  copySelectedButton.addEventListener('click', () => {
    const links = []
    rankList.forEach((entry) => {
      Array.isArray(entry.videos) &&
        entry.videos.forEach((video) => {
          video.checked &&
            video.video_id &&
            links.push('https://www.douyin.com/video/' + video.video_id)
        })
    })
    copyLinks(links, '（选中）')
  })
  downloadSelectedButton.addEventListener('click', async () => {
    const selectedVideos = []
    console.log('🔍 开始检查rankList中的视频选择状态...')
    rankList.forEach((entry) => {
      entry.videos &&
        Array.isArray(entry.videos) &&
        entry.videos.forEach((video) => {
          video.checked &&
            video.video_id &&
            selectedVideos.push({
              author_id: entry.id || '',
              author_name: entry.name || '',
              video_play_url: video.video_play_url || '',
              video_id: video.video_id || '',
            })
        })
    })
    if (selectedVideos.length === 0) {
      showToast('请选择要复制的内容')
      return
    }
    const downloads = selectedVideos
      .map((video) => ({
        url: video.video_play_url || '',
        author_name: video.author_name,
        video_id: video.video_id,
        filename: video.author_name + '_' + video.video_id + '.mp4',
      }))
      .filter((download) => download.url && download.url.startsWith('http'))
    downloads.length !== 0
      ? await downloadVideosInBatch(downloads)
      : showToast('❌ 没有找到有效的视频下载链接，无法下载')
  })
  panel.appendChild(header)
  panel.appendChild(filters)
  panel.appendChild(list)
  panel.appendChild(pagination)
  overlay.appendChild(panel)
  title.textContent = '大懒虫 · 视频列表'
  prepareCommerceDialog(overlay, panel, header, closeButton)
  filters.classList.add('dlc-commerce-toolbar')
  pagination.classList.add('dlc-commerce-pagination')
  downloadSelectedButton.classList.add('dlc-commerce-primary')
  clearButton.classList.add('dlc-commerce-danger')
  layoutCommerceMain(
    panel,
    filters,
    list,
    copiedCount,
    copyPageButton,
    copyAllButton,
    copySelectedButton,
    downloadSelectedButton,
  )
  document.body.appendChild(overlay)
}
function setProductCardSelectedStyle(card, selected) {
  selected
    ? ((card.style.background = '#E8F0FE'), (card.style.borderColor = '#8FBEF7'))
    : ((card.style.background = '#fff'), (card.style.borderColor = '#F3F3F3'))
}
function updateProductCheckboxState(rowIndex) {
  const row = rankList[rowIndex]
  if (!row || !Array.isArray(row.videos)) return
  const allChecked = row.videos.every((video) => video.checked),
    someChecked = row.videos.some((video) => video.checked),
    checkbox = document.querySelector('.product-checkbox[data-product-index="' + rowIndex + '"]')
  if (checkbox) {
    checkbox.checked = allChecked
    checkbox.indeterminate = !allChecked && someChecked
    const card = checkbox.closest('div[style*="display: flex"]')
    card && setProductCardSelectedStyle(card, someChecked)
  }
  row.checked = allChecked
}
function setVideoChecked(rowIndex, videoIndex, checked, skipProductUpdate) {
  const row = rankList[rowIndex]
  if (!row || !Array.isArray(row.videos)) return
  const video = row.videos[videoIndex]
  if (!video) return
  video.checked = !!checked
  document
    .querySelectorAll(
      '.video-checkbox[data-product-index="' +
        rowIndex +
        '"][data-video-index="' +
        videoIndex +
        '"]',
    )
    .forEach((checkbox) => {
      checkbox.checked = !!checked
    })
  document
    .querySelectorAll(
      '.video-checkbox-modal[data-product-index="' +
        rowIndex +
        '"][data-video-index="' +
        videoIndex +
        '"]',
    )
    .forEach((checkbox) => {
      checkbox.checked = !!checked
    })
  if (!skipProductUpdate) updateProductCheckboxState(rowIndex)
}
function showMoreVideosModal(row, rowIndex, listMode) {
  ensureAntdComponentStyles()
  const overlay = document.createElement('div')
  overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, .45);
        z-index: 10002;
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 64px 24px 24px;
        box-sizing: border-box;
    `
  const panel = document.createElement('div')
  panel.style.cssText = `
        width: min(760px, calc(100vw - 48px));
        max-height: calc(100vh - 88px);
        overflow-y: auto;
        position: relative;
        background: #fff;
        border-radius: 8px;
        padding: 20px 24px 24px;
        box-shadow: 0 6px 16px 0 rgba(0, 0, 0, .08), 0 3px 6px -4px rgba(0, 0, 0, .12), 0 9px 28px 8px rgba(0, 0, 0, .05);
        box-sizing: border-box;
    `
  const header = document.createElement('div')
  header.style.cssText = `
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin: -2px 0 16px;
        padding-bottom: 16px;
        border-bottom: 1px solid #F3F3F3;
    `
  const title = document.createElement('h3')
  title.textContent = (row.name || '未知产品') + ' - 所有视频'
  title.style.cssText = `
        margin: 0;
        color: rgba(0, 0, 0, .88);
        font-size: 16px;
        font-weight: 600;
        line-height: 1.5;
        padding-right: 16px;
        word-break: break-word;
    `
  const closeButton = document.createElement('button')
  closeButton.textContent = '×'
  closeButton.style.cssText = `
        background: transparent;
        border: none;
        font-size: 22px;
        cursor: pointer;
        color: rgba(0, 0, 0, .45);
        padding: 0;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        flex: 0 0 auto;
        transition: background .2s, color .2s;
    `
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.background = 'rgba(0, 0, 0, .04)'
    closeButton.style.color = 'rgba(0, 0, 0, .88)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.background = 'transparent'
    closeButton.style.color = 'rgba(0, 0, 0, .45)'
  })
  closeButton.addEventListener('click', () => {
    document.body.removeChild(overlay)
  })
  header.appendChild(title)
  header.appendChild(closeButton)
  panel.appendChild(header)
  let selectedAuthor = ''
  if (listMode) {
    const filters = document.createElement('div')
    filters.classList.add('dlc-commerce-toolbar')
    filters.style.cssText = `
        margin-bottom: 16px;
        padding: 12px 16px;
        background: #fafafa;
        border: 1px solid #F3F3F3;
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        box-sizing: border-box;
    `
    const authorLabel = document.createElement('label')
    authorLabel.textContent = '筛选达人'
    authorLabel.style.cssText = `
        color: rgba(0, 0, 0, .88);
        font-size: 14px;
        font-weight: 500;
        user-select: none;
        white-space: nowrap;
    `
    const authors = new Map()
    ;(row.videos || []).forEach((video) => {
      const authorKey = String(video.author_id || video.author_name || '')
      authorKey &&
        !authors.has(authorKey) &&
        authors.set(authorKey, {
          name: video.author_name || '未知达人',
          id: video.author_id || '',
        })
    })
    const sortedAuthors = Array.from(authors.entries()).sort((leftAuthor, rightAuthor) =>
        leftAuthor[1].name.localeCompare(rightAuthor[1].name, 'zh-CN'),
      ),
      authorSelect = document.createElement('select')
    authorSelect.style.cssText = `
        height: 32px;
        padding: 0 10px;
        padding-right: 28px;
        border: 1px solid #DCDCDC;
        border-radius: 6px;
        font-size: 13px;
        color: rgba(0, 0, 0, .88);
        background: #fff;
        flex: 1;
        max-width: 260px;
        outline: none;
        transition: border-color .2s;
        cursor: pointer;
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23999999'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 8px center;
    `
    const allAuthorsOption = document.createElement('option')
    allAuthorsOption.value = ''
    allAuthorsOption.textContent = '全部达人'
    authorSelect.appendChild(allAuthorsOption)
    sortedAuthors.forEach(([authorKey, author]) => {
      const option = document.createElement('option')
      option.value = authorKey
      option.textContent = author.name
      authorSelect.appendChild(option)
    })
    authorSelect.addEventListener('change', () => {
      selectedAuthor = authorSelect.value
      renderVideos()
      refreshSelectAll()
    })
    const selection = document.createElement('div')
    selection.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        user-select: none;
        margin-right: 8px;
    `
    const selectAll = document.createElement('input')
    selectAll.type = 'checkbox'
    selectAll.id = 'more-select-all'
    selectAll.className = 'xm-ant-checkbox'
    selectAll.style.cssText = `
        width: 16px;
        height: 16px;
        cursor: pointer;
        flex: 0 0 auto;
    `
    const selectAllLabel = document.createElement('label')
    selectAllLabel.htmlFor = 'more-select-all'
    selectAllLabel.textContent = '全选'
    selectAllLabel.style.cssText = `
        font-size: 13px;
        color: rgba(0, 0, 0, .88);
        cursor: pointer;
        white-space: nowrap;
    `
    selectAll.addEventListener('change', () => {
      const checked = selectAll.checked,
        checkboxes = list.querySelectorAll('.video-checkbox-modal')
      checkboxes.forEach((checkbox) => {
        checkbox.checked = checked
        checkbox.dispatchEvent(
          new Event('change', {
            bubbles: true,
          }),
        )
      })
    })
    selection.appendChild(selectAll)
    selection.appendChild(selectAllLabel)
    filters.appendChild(selection)
    filters.appendChild(authorLabel)
    filters.appendChild(authorSelect)
    panel.appendChild(filters)
  }
  const list = document.createElement('div')
  listMode
    ? (list.style.cssText = `
        display: flex;
        flex-direction: column;
        gap: 12px;
        overflow-x: auto;
        padding: 4px 0 0;
    `)
    : (list.style.cssText = `
        display: grid;
        grid-template-columns: repeat(5, minmax(96px, 1fr));
        gap: 14px;
        overflow-x: auto;
        padding: 4px 0 0;
    `)
  function createMetric(label, value) {
    if (value === undefined || value === null || value === '') return null
    return createStatColumn(label, value)
  }
  function createVideoRow(video, videoIndex) {
    const card = document.createElement('div')
    card.classList.add('dlc-commerce-row')
    card.style.cssText = `
            display: flex;
            align-items: flex-start;
            gap: 12px;
            padding: 12px;
            border: 1px solid #F3F3F3;
            border-radius: 8px;
            background: #fff;
            transition: all .2s;
            box-sizing: border-box;
        `
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.className = 'video-checkbox-modal xm-ant-checkbox'
    checkbox.dataset.productIndex = rowIndex
    checkbox.dataset.videoIndex = videoIndex
    checkbox.checked = row.videos[videoIndex]?.checked || false
    checkbox.style.cssText = `
        width: 18px;
        height: 18px;
        cursor: pointer;
        flex: 0 0 auto;
        margin-top: 2px;
    `
    checkbox.addEventListener('change', () => {
      setVideoChecked(rowIndex, videoIndex, checkbox.checked)
      refreshSelectAll()
    })
    const thumbnail = document.createElement('div')
    thumbnail.style.cssText = `
            position: relative;
            width: 90px;
            height: 160px;
            flex: 0 0 auto;
            border-radius: 8px;
            overflow: hidden;
            border: 1px solid #F3F3F3;
        `
    const cover = document.createElement('img')
    cover.src = video.video_img || ''
    cover.style.cssText = `
            width: 90px;
            height: 160px;
            object-fit: cover;
            cursor: pointer;
            transition: border-color .2s;
            display: block;
        `
    cover.addEventListener('mouseenter', () => {
      cover.style.borderColor = '#0052D9'
    })
    cover.addEventListener('mouseleave', () => {
      cover.style.borderColor = '#F3F3F3'
    })
    cover.addEventListener('click', (event) => {
      event.stopPropagation()
      openDouyinVideoDetail(video)
    })
    const info = document.createElement('div')
    info.style.cssText = `
            flex: 1 1 180px;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 4px;
        `
    const videoTitle = document.createElement('div')
    videoTitle.textContent = video.video_name || '未知视频'
    videoTitle.style.cssText = `
            color: rgba(0, 0, 0, .88);
            font-size: 14px;
            font-weight: 600;
            line-height: 1.4;
            word-break: break-word;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            cursor: pointer;
        `
    videoTitle.addEventListener('click', (event) => {
      event.stopPropagation()
      openDouyinVideoDetail(video)
    })
    const authorLabel = document.createElement('div')
    authorLabel.textContent =
      (video.author_name || '未知达人') + (video.author_id ? ' (ID: ' + video.author_id + ')' : '')
    authorLabel.style.cssText = `
            color: rgba(0, 0, 0, .65);
            font-size: 13px;
            line-height: 1.4;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        `
    const publishLabel = document.createElement('div')
    publishLabel.textContent = video.publish_ts
      ? '发布时间 ' + formatCompetePublishTime(video.publish_ts)
      : ''
    publishLabel.style.cssText = `
            color: rgba(0, 0, 0, .45);
            font-size: 12px;
            line-height: 1.4;
        `
    info.appendChild(videoTitle)
    info.appendChild(authorLabel)
    if (video.publish_ts) info.appendChild(publishLabel)
    const metrics = document.createElement('div')
    metrics.style.cssText = `
            display: flex;
            align-items: center;
            gap: 18px;
            flex: 0 0 auto;
            flex-wrap: wrap;
        `
    const extraMetrics = video.extra || {},
      metricDefinitions = [
        {
          keys: ['pay_amt', 'payAmt', 'gmv', 'sales', 'order_gmv'],
          label: '支付金额',
        },
        {
          keys: ['pay_combo_cnt', 'payComboCnt', 'pay_order_cnt', 'order_cnt'],
          label: '成交件数',
        },
        {
          keys: ['product_click_cnt', 'productClickCnt', 'click_cnt', 'clickCnt'],
          label: '点击次数',
        },
        {
          keys: ['exposure_cnt', 'exposureCnt', 'show_cnt'],
          label: '曝光次数',
        },
        {
          keys: ['play_cnt', 'playCnt', 'video_play_cnt'],
          label: '播放量',
        },
        {
          keys: ['like_cnt', 'likeCnt', 'digg_cnt'],
          label: '点赞量',
        },
        {
          keys: ['comment_cnt', 'commentCnt', 'comment_count'],
          label: '评论量',
        },
        {
          keys: ['share_cnt', 'shareCnt', 'share_count'],
          label: '分享量',
        },
      ],
      usedKeys = new Set()
    metricDefinitions.forEach(({ keys: keys, label: label }) => {
      for (const key of keys) {
        let value = extraMetrics[key]
        if (value !== undefined && value !== null && value !== '') {
          usedKeys.add(key)
          if (typeof value === 'object' && value.value_range) value = formatRangeValue(value)
          else typeof value === 'number' && (value = formatNumber(value))
          const metric = createMetric(label, value)
          if (metric) metrics.appendChild(metric)
          break
        }
      }
    })
    Object.keys(extraMetrics || {}).forEach((key) => {
      if (usedKeys.has(key)) return
      let value = extraMetrics[key]
      if (value === undefined || value === null || value === '') return
      if (typeof value === 'object') return
      if (typeof value !== 'number') return
      const label = key
          .replace(/_/g, ' ')
          .replace(/([A-Z])/g, ' $1')
          .trim(),
        metric = createMetric(label, formatNumber(value))
      if (metric) metrics.appendChild(metric)
    })
    thumbnail.appendChild(cover)
    card.appendChild(checkbox)
    card.appendChild(thumbnail)
    card.appendChild(info)
    if (metrics.children.length) card.appendChild(metrics)
    layoutCommerceVideoRow(card, checkbox, thumbnail, info, metrics)
    return card
  }
  function refreshSelectAll() {
    if (!listMode) return
    const selectAll = document.getElementById('more-select-all')
    if (!selectAll) return
    const checkboxes = Array.from(list.querySelectorAll('.video-checkbox-modal'))
    if (checkboxes.length === 0) {
      selectAll.checked = false
      selectAll.indeterminate = false
      return
    }
    const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length
    selectAll.checked = checkedCount === checkboxes.length
    selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length
  }
  function renderVideos() {
    list.innerHTML = ''
    const authorQuery = String(selectedAuthor || '').trim(),
      visibleVideos = (row.videos || [])
        .map((video, videoIndex) => ({
          video: video,
          idx: videoIndex,
        }))
        .filter(({ video: video }) => {
          if (!authorQuery) return true
          const authorKey = String(video.author_id || video.author_name || '')
          return authorKey === authorQuery
        })
    if (visibleVideos.length === 0) {
      const emptyState = document.createElement('div')
      emptyState.textContent = authorQuery ? '没有匹配的达人' : '该产品暂无视频'
      emptyState.style.cssText = listMode
        ? `
          padding: 48px 0;
          text-align: center;
          color: rgba(0, 0, 0, .45);
          font-size: 14px;
      `
        : `
          grid-column: 1 / -1;
          padding: 48px 0;
          text-align: center;
          color: rgba(0, 0, 0, .45);
          font-size: 14px;
      `
      list.appendChild(emptyState)
      return
    }
    listMode
      ? (visibleVideos.forEach(({ video: video, idx: videoIndex }) => {
          list.appendChild(createVideoRow(video, videoIndex))
        }),
        refreshSelectAll())
      : visibleVideos.forEach(({ video: video, idx: videoIndex }) => {
          const card = document.createElement('div')
          card.classList.add('dlc-commerce-video-card')
          card.style.cssText = `
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 8px;
            position: relative;
            min-width: 0;
        `
          const thumbnail = document.createElement('div')
          thumbnail.style.cssText = `
            position: relative;
            width: 96px;
            height: 170px;
            flex: 0 0 auto;
        `
          const checkbox = document.createElement('input')
          checkbox.type = 'checkbox'
          checkbox.className = 'video-checkbox-modal xm-ant-checkbox xm-video-thumb-checkbox'
          checkbox.dataset.productIndex = rowIndex
          checkbox.dataset.videoIndex = videoIndex
          checkbox.checked = row.videos[videoIndex]?.checked || false
          checkbox.addEventListener('change', () => {
            setVideoChecked(rowIndex, videoIndex, checkbox.checked)
          })
          const cover = document.createElement('img')
          cover.src = video.video_img || ''
          cover.style.cssText = `
            width: 96px;
            height: 170px;
            border-radius: 8px;
            object-fit: cover;
            border: 1px solid #F3F3F3;
            transition: border-color .2s;
            cursor: pointer;
        `
          const videoTitle = document.createElement('div')
          videoTitle.textContent = video.video_name || '未知视频'
          videoTitle.style.cssText = `
            color: rgba(0, 0, 0, .65);
            font-size: 12px;
            text-align: center;
            max-width: 104px;
            word-break: break-word;
            line-height: 1.4;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
        `
          cover.addEventListener('mouseenter', () => {
            cover.style.borderColor = '#0052D9'
          })
          cover.addEventListener('mouseleave', () => {
            cover.style.borderColor = '#F3F3F3'
          })
          cover.addEventListener('click', (event) => {
            event.stopPropagation()
            openDouyinVideoDetail(video)
          })
          thumbnail.appendChild(checkbox)
          thumbnail.appendChild(cover)
          card.appendChild(thumbnail)
          card.appendChild(videoTitle)
          list.appendChild(card)
        })
  }
  renderVideos()
  panel.appendChild(list)
  overlay.appendChild(panel)
  title.textContent = (row.name || '视频') + ' · 关联视频'
  prepareCommerceDialog(overlay, panel, header, closeButton)
  overlay.classList.add('dlc-commerce-overlay-detail')
  list.classList.add(listMode ? 'dlc-commerce-video-list' : 'dlc-commerce-video-grid')
  layoutCommerceDetail(panel, list, row)
  document.body.appendChild(overlay)
}
function createDownloadFolderName() {
  const now = new Date()
  return (
    '抖音视频_' +
    now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  )
} // Only one submission batch runs per page, including across dialog close/reopen.
let commerceDownloadBatchRunning = false
async function downloadVideosInBatch(videos) {
  if (commerceDownloadBatchRunning) return
  commerceDownloadBatchRunning = true
  refreshCommerceSelectionActions()
  try {
    const folderName = createDownloadFolderName()
    const batchTime = Date.now()
    const total = videos.length
    const progress = showProgressToast(`正在提交下载任务 0/${total}`, 0, 'info')
    let nextIndex = 0
    let processed = 0
    let submitted = 0
    let failed = 0

    // Bound bridge/probe work; completion order never determines progress.
    async function submitNext() {
      while (nextIndex < total) {
        const index = nextIndex++
        const video = videos[index]
        const filename = `${video.author_name}_${video.video_id}_${batchTime}_${index}.mp4`
        try {
          if (!/^https?:\/\//.test(video.url)) throw new Error('视频下载地址无效')
          await requestBrowserDownload(video.url, filename, folderName)
          submitted += 1
        } catch (error) {
          failed += 1
          console.error(`提交下载任务失败：${filename}`, error)
        } finally {
          processed += 1
          progress.update(
            `正在提交下载任务 ${processed}/${total}`,
            Math.round((processed / total) * 100),
            'info',
          )
        }
      }
    }
    await Promise.all(
      Array.from(
        {
          length: Math.min(3, total),
        },
        () => submitNext(),
      ),
    )
    // The bridge acknowledges Chrome task creation, not file completion.
    progress.update(
      `已提交 ${submitted} 个下载任务，失败 ${failed} 个`,
      100,
      failed ? 'error' : 'success',
    )
    setTimeout(() => progress.dismiss(), 4000)
  } catch (error) {
    console.error('提交下载任务失败', error)
    showToast('提交下载任务失败')
  } finally {
    commerceDownloadBatchRunning = false
    refreshCommerceSelectionActions()
  }
}
async function requestBrowserDownload(url, filename, folderName) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      clearTimeout(timer)
      window.removeEventListener('message', onResponse)
    }
    function onResponse(event) {
      const response = event.data
      if (
        event.source !== window ||
        response?.type !== 'DOWNLOAD_FILE_RESPONSE' ||
        response.filename !== filename
      )
        return
      cleanup()
      if (response.success) resolve(response)
      else reject(new Error(response.error || '下载任务提交失败'))
    }
    const timer = setTimeout(() => {
      cleanup()
      // A lost acknowledgement may still have created a task; never retry it here.
      reject(new Error('下载任务提交超时，未收到浏览器确认'))
    }, 120000)
    window.addEventListener('message', onResponse)
    try {
      window.postMessage(
        {
          type: 'DOWNLOAD_FILE_REQUEST',
          url,
          filename,
          folderName,
          attempt: 1,
        },
        '*',
      )
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

// Presentation helpers own only extension-created nodes and their keyboard behavior.
function prepareCommerceCloseButton(button) {
  button.type = 'button'
  button.setAttribute('aria-label', '关闭')
  button.classList.add('dlc-commerce-close')
  button.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>'
}
function prepareCommerceDialog(overlay, panel, header, closeButton) {
  overlay.classList.add('dlc-commerce-overlay')
  panel.classList.add('dlc-commerce-dialog')
  header.classList.add('dlc-commerce-header')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-label', header.firstElementChild.textContent)
  const previousFocus = document.activeElement
  prepareCommerceCloseButton(closeButton)
  closeButton.addEventListener('click', () => {
    if (previousFocus.isConnected) previousFocus.focus()
  })
  // Keep keyboard navigation inside this dialog; Escape never dismisses it.
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
    }
    if (event.key !== 'Tab') return
    const controls = Array.from(
      panel.querySelectorAll('button, input, select, [tabindex="0"]'),
    ).filter((element) => !element.disabled && element.getClientRects().length)
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  queueMicrotask(() => {
    refreshCommerceSelectionActions()
    closeButton.focus()
  })
}
function prepareCommerceBadge(badge) {
  badge.setAttribute('role', 'button')
  badge.setAttribute('aria-label', '打开视频列表')
  badge.tabIndex = 0
  const label = badge.querySelector('span')
  label.textContent = '大懒虫 · 视频'
  badge.lastElementChild.textContent = ''
  badge.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      showVideoDownloadModal()
    }
  })
}

// Layout moves the original nodes so their handlers and product/video indexes survive.
function layoutCommerceMain(
  panel,
  filters,
  list,
  count,
  copyPage,
  copyAll,
  copySelected,
  downloadSelected,
) {
  list.classList.add('dlc-commerce-scroll', 'dlc-commerce-groups')
  const footer = document.createElement('div')
  footer.className = 'dlc-commerce-footer'
  const listActions = document.createElement('div')
  listActions.className = 'dlc-commerce-list-actions'
  listActions.setAttribute('aria-label', '当前筛选结果')
  copyAll.textContent = '复制筛选结果'
  listActions.append(copyPage, copyAll)
  footer.append(
    listActions,
    createCommerceSelectionActions(count, copySelected, downloadSelected, () => rankList),
  )
  panel.append(footer)
  filters.classList.add('dlc-commerce-filters')
}
function createCommerceSelectionActions(count, copy, download, getRows) {
  const group = document.createElement('div')
  group.className = 'dlc-commerce-selection'
  // Main-dialog actions span the whole selection; detail actions own one object's rows.
  group.commerceSelectionRows = getRows
  count.classList.add('dlc-commerce-selection-count')
  copy.classList.add('dlc-commerce-copy-selected')
  download.classList.add('dlc-commerce-primary')
  group.append(count, copy, download)
  return group
}
function refreshCommerceSelectionActions() {
  for (const group of document.querySelectorAll('.dlc-commerce-selection')) {
    let selected = 0
    let downloadable = false
    for (const row of group.commerceSelectionRows()) {
      for (const video of row.videos || []) {
        if (!video.checked) continue
        selected += 1
        if (/^https?:\/\//.test(video.video_play_url || '')) downloadable = true
      }
    }
    group.querySelector('.dlc-commerce-selection-count').textContent = `已选中 ${selected} 条`
    group.querySelector('.dlc-commerce-copy-selected').disabled = selected === 0
    const download = group.querySelector('.dlc-commerce-primary')
    download.disabled = commerceDownloadBatchRunning || !downloadable
    download.textContent = commerceDownloadBatchRunning ? '提交中…' : '下载选中'
  }
}
function layoutCommerceDetail(panel, list, row) {
  list.classList.add('dlc-commerce-scroll')
  const footer = document.createElement('div')
  footer.className = 'dlc-commerce-footer dlc-commerce-detail-footer'
  const count = document.createElement('span')
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = '复制选中'
  copy.addEventListener('click', async () => {
    const links = row.videos
      .filter((video) => video.checked && video.video_id)
      .map((video) => `https://www.douyin.com/video/${video.video_id}`)
    try {
      await navigator.clipboard.writeText(links.join('\n'))
      totalCopiedCount += links.length
      showToast(`已复制 ${links.length} 条`)
    } catch (error) {
      console.error('复制失败', error)
      showToast(error.message)
    }
  })
  const download = document.createElement('button')
  download.type = 'button'
  download.textContent = '下载选中'
  download.addEventListener('click', () => {
    const videos = row.videos
      .filter(
        (video) =>
          video.checked && video.video_id && /^https?:\/\//.test(video.video_play_url || ''),
      )
      .map((video) => ({
        url: video.video_play_url,
        video_id: video.video_id,
        author_name: video.author_name || row.name || '',
      }))
    downloadVideosInBatch(videos)
  })
  footer.append(createCommerceSelectionActions(count, copy, download, () => [row]))
  panel.append(footer)
}
function layoutCommerceGroup(card, checkbox, identityNodes, metrics, videoNodes, row) {
  const identity = document.createElement('div')
  identity.className = 'dlc-commerce-group-identity'
  identity.append(checkbox, ...identityNodes)
  const section = document.createElement('div')
  section.className = 'dlc-commerce-group-videos'
  const heading = document.createElement('div')
  heading.className = 'dlc-commerce-video-heading'
  const title = document.createElement('span')
  title.textContent = `关联视频 ${row.videos.length}`
  heading.append(title)
  const content = document.createElement('div')
  content.className = 'dlc-commerce-group-media'
  content.append(...videoNodes)
  if (videoNodes[0].tagName === 'IMG') videoNodes[0].classList.add('dlc-commerce-featured-cover')
  const more = content.querySelector('[role="button"]')
  if (more) {
    more.classList.add('dlc-commerce-more')
    more.textContent = '查看全部'
    more.tabIndex = 0
    more.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        more.click()
      }
    })
    heading.append(more)
  }
  for (const image of content.querySelectorAll('.video-thumbnail')) {
    const thumbnail = image.parentElement
    const input = thumbnail.querySelector('.video-checkbox')
    const video = row.videos[Number(input.dataset.videoIndex)]
    image.alt = video.video_name || '视频封面'
    thumbnail.classList.add('dlc-commerce-thumbnail')
    // Thumbnail strips have no text column; add their own video title to identify selections.
    if (videoNodes[0].classList.contains('dlc-commerce-thumbnails')) {
      const caption = document.createElement('span')
      caption.className = 'dlc-commerce-thumbnail-title'
      caption.textContent = video.video_name || '视频'
      caption.title = video.video_name || ''
      thumbnail.append(caption)
    }
  }
  section.append(heading, content)
  card.replaceChildren(identity)
  if (metrics) {
    metrics.classList.add('dlc-commerce-metrics')
    card.append(metrics)
  }
  card.append(section)
}
function layoutCommerceVideoRow(card, checkbox, thumbnail, content, metrics) {
  const media = document.createElement('div')
  media.className = 'dlc-commerce-detail-media'
  media.append(checkbox, thumbnail, content)
  card.replaceChildren(media)
  if (metrics.children.length) {
    metrics.classList.add('dlc-commerce-metrics')
    card.append(metrics)
  }
}
