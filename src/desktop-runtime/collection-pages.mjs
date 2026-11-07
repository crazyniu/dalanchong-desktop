/**
 * AI module map
 * Purpose: define the website pages where collection is supported.
 * Entry: collectionPage identifies a source page; isSupportedCollectionPage is shared
 * by the toolbar and collection runner. platform.mjs uses the source key for schemas.
 * Invariants: match the platform's exact HTTPS origin and pathname. Query parameters
 * and fragments belong to the page's filters and do not change page support.
 */

const pages = {
  kuaishou: {
    origin: 'https://cps.kwaixiaodian.com',
    routes: {
      '/zone/daren-match/daren-square-pro': 'ks-square',
      '/zone/daren-match/peer-reference': 'ks-peer',
      '/zone-cps/promoter-rank-list': 'ks-rank',
    },
  },
  douyin: {
    origin: 'https://buyin.jinritemai.com',
    routes: {
      '/dashboard/servicehall/daren-square': 'dy-square',
      '/dashboard/servicehall/clue-daren': 'dy-clue',
      '/dashboard/servicehall/peer-reference': 'dy-peer',
      '/dashboard/ranklist/daren': 'dy-rank',
    },
  },
}

export function collectionPage(platform, url) {
  if (!url) return null
  const current = new URL(url)
  const supported = pages[platform]
  return current.origin === supported.origin
    ? supported.routes[current.pathname] || null
    : null
}

export function isSupportedCollectionPage(platform, url) {
  return collectionPage(platform, url) !== null
}
