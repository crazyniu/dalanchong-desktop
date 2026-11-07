/**
 * AI module map
 * Purpose: share per-account native page URL, readiness, and refresh state across commerce views.
 * Entry: useGuestState, setGuestState, retryGuest, listenBrowserEvents, reloadPlatform,
 * navigatePlatform, and traversePlatform.
 * Flow: one assistant:browser subscription maps native navigation/ready/error events to
 * loading states; SPA route events update only the URL. Retry counters invalidate
 * preparation in browser.tsx, while reloads and failures retain the last observed URL.
 * Invariant: page readiness is not proof of account login or licensing. Keep account IDs
 * scoped and return actual reload errors instead of manufacturing a ready state.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { create } from 'zustand'
import { desktop } from './desktop'

export type BrowserEvent = {
  accountId: string
  type: 'navigation' | 'ready' | 'error' | 'response' | 'route'
  source: string
  workspace: boolean
  url?: string
  error?: string
  request?: unknown
  response?: unknown
}
type GuestState = {
  status: 'loading' | 'ready' | 'error'
  error?: string
  url?: string
}
export const useGuestState = create<{
  sessions: Record<string, GuestState>
  attempts: Record<string, number>
}>(() => ({ sessions: {}, attempts: {} }))
export function setGuestState(id: string, state: GuestState) {
  useGuestState.setState((s) => {
    const previous = s.sessions[id]
    const next = { ...state, url: state.url ?? previous?.url }
    if (previous && previous.status === next.status && previous.error === next.error &&
        previous.url === next.url) return s
    return { sessions: { ...s.sessions, [id]: next } }
  })
}
export function retryGuest(id: string) {
  useGuestState.setState((s) => ({
    sessions: {
      ...s.sessions,
      [id]: { status: 'loading', url: s.sessions[id]?.url },
    },
    attempts: { ...s.attempts, [id]: (s.attempts[id] || 0) + 1 },
  }))
}
export function browserError(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

let browserEvents: Promise<UnlistenFn> | undefined
export function listenBrowserEvents() {
  browserEvents ??= listen<BrowserEvent>('assistant:browser', ({ payload }) => {
    if (!payload.workspace || payload.request) return
    const { accountId, type, error, url } = payload
    if (type === 'route') {
      const current = useGuestState.getState().sessions[accountId]
      setGuestState(accountId, {
        ...current,
        status: current?.status ?? 'loading',
        url,
      })
    }
    if (type === 'navigation')
      setGuestState(accountId, { status: 'loading', url })
    if (type === 'ready') setGuestState(accountId, { status: 'ready', url })
    if (type === 'error') {
      setGuestState(accountId, { status: 'error', error, url })
      toast.error(error)
    }
  })
  return browserEvents
}
if (desktop)
  void listenBrowserEvents().catch((error) => toast.error(browserError(error)))
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void browserEvents?.then((unlisten) => unlisten())
  })
}

export async function reloadPlatform(accountId: string): Promise<boolean> {
  return navigatePlatform(accountId)
}

export async function navigatePlatform(
  accountId: string,
  url?: string
): Promise<boolean> {
  if (!desktop) return true
  setGuestState(accountId, { status: 'loading' })
  try {
    await listenBrowserEvents()
    await invoke('browser_navigate', { accountId, url })
    return true
  } catch (error) {
    const message = browserError(error)
    setGuestState(accountId, { status: 'error', error: message })
    toast.error(`网页跳转失败：${message}`)
    return false
  }
}

export async function traversePlatform(
  accountId: string,
  direction: 'back' | 'forward'
) {
  if (!desktop) return
  try {
    // Do not manufacture a loading state: traversal at either history boundary
    // is a no-op, and real document loads emit their existing native events.
    await invoke('browser_history', { accountId, direction })
  } catch (error) {
    toast.error(`网页跳转失败：${browserError(error)}`)
  }
}
