/**
 * AI module map
 * Purpose: type the shared platform-page support contract implemented in collection-pages.mjs.
 * Entry: collectionPage and isSupportedCollectionPage are consumed by React and runtime code.
 * Invariant: platform names and source keys match the explicitly supported routes.
 */

type Platform = 'kuaishou' | 'douyin'
type CollectionPage =
  | 'ks-square'
  | 'ks-peer'
  | 'ks-rank'
  | 'dy-square'
  | 'dy-clue'
  | 'dy-peer'
  | 'dy-rank'

export function collectionPage(
  platform: Platform,
  url?: string | null
): CollectionPage | null

export function isSupportedCollectionPage(
  platform: Platform,
  url?: string | null
): boolean
