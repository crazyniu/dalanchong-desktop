/**
 * AI module map
 * Purpose: expose the shared sub-768px responsive breakpoint as a React external store.
 * Entry: useIsMobile is consumed by sidebar layout.
 * Flow: subscribe to matchMedia changes, return the current match, and remove the listener
 * when React unsubscribes. Stable callbacks and one shared MediaQueryList avoid
 * re-registering or allocating another browser query on parent renders.
 * The server snapshot is false.
 * Invariant: this detects viewport width, not operating system or native capability.
 */

import * as React from 'react'

const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`
let mediaQuery: MediaQueryList | undefined
const getMediaQuery = () => mediaQuery ??= window.matchMedia(MOBILE_QUERY)
const subscribe = (callback: () => void) => {
  const mql = getMediaQuery()
  mql.addEventListener('change', callback)
  return () => mql.removeEventListener('change', callback)
}
const getSnapshot = () => getMediaQuery().matches
const getServerSnapshot = () => false

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
