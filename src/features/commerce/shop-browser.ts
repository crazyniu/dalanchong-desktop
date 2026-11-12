/**
 * AI module map
 * Purpose: own route-independent shop-browser opening and installation progress.
 * Entry: openShopBrowser invokes main-only chrome_open; useShopBrowser supplies the
 * per-account opening set and the global overlay's browser-install state.
 * Flow: one Tauri Channel per native request updates the shared non-persisted store.
 * Duplicate requests for one account share a promise; other accounts remain usable.
 * Native installation serialization determines which request reports progress. Only
 * that reporting request may clear or fail its card; an installed-engine request
 * cannot erase another request's download. Failed opens never fabricate account data.
 * State: requests/channels outlive route components. Dismissal clears terminal card
 * feedback only and never cancels native installation or browser opening.
 */

import { Channel, invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { create } from 'zustand'
import { browserError } from './browser-session'

export type ChromeAccount = {
  id: string
  number: number
  name: string
  windowScale: number
  lastOpenedAt: string | null
}

export type BrowserInstallProgress = {
  stage: 'downloading' | 'verifying' | 'installing' | 'ready'
  downloaded: number
  total: number | null
}

export type BrowserInstallState = BrowserInstallProgress & { error?: string }

export const useShopBrowser = create<{
  opening: string[]
  install: BrowserInstallState | null
}>(() => ({ opening: [], install: null }))

const requests = new Map<string, Promise<ChromeAccount | undefined>>()
let installOwner: string | null = null

async function openNative(id: string): Promise<ChromeAccount | undefined> {
  let hasProgress = false
  const onProgress = new Channel<BrowserInstallProgress>()
  onProgress.onmessage = (next) => {
    if (!hasProgress) {
      hasProgress = true
      installOwner = id
    }
    if (installOwner === id) useShopBrowser.setState({ install: next })
  }
  try {
    const account = await invoke<ChromeAccount>('chrome_open', { id, onProgress })
    if (hasProgress && installOwner === id) {
      installOwner = null
      useShopBrowser.setState({ install: null })
    }
    return account
  } catch (reason) {
    const error = browserError(reason)
    const install = useShopBrowser.getState().install
    if (hasProgress && installOwner === id && install) {
      useShopBrowser.setState({ install: { ...install, error } })
    } else {
      toast.error(error)
    }
    return undefined
  }
}

export function openShopBrowser(id: string): Promise<ChromeAccount | undefined> {
  const pending = requests.get(id)
  if (pending) return pending
  useShopBrowser.setState((state) => ({ opening: [...state.opening, id] }))
  const request = openNative(id).finally(() => {
    requests.delete(id)
    useShopBrowser.setState((state) => ({ opening: state.opening.filter((accountId) => accountId !== id) }))
  })
  requests.set(id, request)
  return request
}

export function dismissBrowserInstall() {
  const { install } = useShopBrowser.getState()
  if (!install || (!install.error && install.stage !== 'ready')) return
  installOwner = null
  useShopBrowser.setState({ install: null })
}
