import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { toast } from 'sonner'
import { create } from 'zustand'
import { desktop } from './desktop'

export type BrowserEvent = {
  accountId: string
  type: 'navigation' | 'ready' | 'error' | 'response'
  source: string
  workspace: boolean
  url?: string
  error?: string
  request?: unknown
  response?: unknown
}
type GuestState = { status: 'loading' | 'ready' | 'error'; error?: string }
export const useGuestState = create<{
  sessions: Record<string, GuestState>
  attempts: Record<string, number>
}>(() => ({ sessions: {}, attempts: {} }))
export function setGuestState(id: string, state: GuestState) {
  useGuestState.setState((s) => ({ sessions: { ...s.sessions, [id]: state } }))
}
export function retryGuest(id: string) {
  useGuestState.setState((s) => ({
    sessions: { ...s.sessions, [id]: { status: 'loading' } },
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
    const { accountId, type, error } = payload
    if (type === 'navigation') setGuestState(accountId, { status: 'loading' })
    if (type === 'ready') setGuestState(accountId, { status: 'ready' })
    if (type === 'error') {
      setGuestState(accountId, { status: 'error', error })
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
  if (!desktop) return true
  setGuestState(accountId, { status: 'loading' })
  try {
    await listenBrowserEvents()
    await invoke('browser_navigate', { accountId })
    return true
  } catch (error) {
    const message = browserError(error)
    setGuestState(accountId, { status: 'error', error: message })
    toast.error(`网页跳转失败：${message}`)
    return false
  }
}
