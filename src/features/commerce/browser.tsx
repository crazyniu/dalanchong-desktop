import { useEffect, useLayoutEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  browserError,
  listenBrowserEvents,
  retryGuest,
  setGuestState,
  useGuestState,
} from './browser-session'
import { desktop } from './desktop'
import { useCommerce } from './store'
import type { Account } from './types'

type Bounds = { left: number; top: number; width: number; height: number }
const useBrowser = create<{
  active: string
  visited: string[]
  prepared: Record<string, number>
  covered: boolean
  bounds: Bounds
}>(() => ({
  active: '',
  visited: [],
  prepared: {},
  covered: false,
  bounds: { left: 0, top: 0, width: 0, height: 0 },
}))

export function BrowserHost({ account }: { account: Account }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useGuestState((s) => s.sessions[account.id])
  useLayoutEffect(() => {
    const host = ref.current!
    const workspace = host.closest('[data-testid="platform-workspace"]')!
    useBrowser.setState((s) => ({
      active: account.id,
      visited: s.visited.includes(account.id)
        ? s.visited
        : [...s.visited, account.id],
    }))
    const measure = () => {
      const r = host.getBoundingClientRect()
      const bounds = {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
      }
      const previous = useBrowser.getState().bounds
      if (
        bounds.left !== previous.left ||
        bounds.top !== previous.top ||
        bounds.width !== previous.width ||
        bounds.height !== previous.height
      ) {
        useBrowser.setState({ bounds })
      }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    const mutations = new MutationObserver(measure)
    mutations.observe(workspace, { childList: true, subtree: true })
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    measure()
    return () => {
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      useBrowser.setState({ active: '' })
      presentBrowser()
    }
  }, [account.id])
  return (
    <div ref={ref} className='relative min-h-0 flex-1 bg-white'>
      {state?.status === 'error' && (
        <div className='absolute inset-0 z-20 grid place-content-center justify-items-center gap-4 bg-white p-6'>
          <p className='text-sm text-destructive'>{state.error}</p>
          <Button variant='outline' onClick={() => retryGuest(account.id)}>
            重新打开网页
          </Button>
        </div>
      )}
    </div>
  )
}

const preparations = new Map<
  string,
  { attempt: number; promise: Promise<void> }
>()
function PlatformGuest({ account }: { account: Account }) {
  const attempt = useGuestState((s) => s.attempts[account.id] || 0)
  useEffect(() => {
    let mounted = true
    let preparation = preparations.get(account.id)
    if (preparation?.attempt !== attempt) {
      if (attempt > 0 || !useGuestState.getState().sessions[account.id]) {
        setGuestState(account.id, { status: 'loading' })
      }
      const promise = listenBrowserEvents()
        .then(() =>
          desktop!.prepareAccount({
            id: account.id,
            platform: account.platform,
          })
        )
        .then(async () => {
          if (attempt > 0)
            await invoke('browser_navigate', { accountId: account.id })
        })
      preparation = { attempt, promise }
      preparations.set(account.id, preparation)
    }
    preparation.promise
      .then(() => {
        if (!mounted) return
        useBrowser.setState((s) => ({
          prepared: { ...s.prepared, [account.id]: attempt },
        }))
      })
      .catch((e) => {
        if (!mounted) return
        const error = browserError(e)
        setGuestState(account.id, { status: 'error', error })
        toast.error(error)
      })
    return () => {
      mounted = false
    }
  }, [account.id, account.platform, attempt])
  return null
}

// Serialize native visibility changes so a slow show cannot outlive a later hide.
let presentation = Promise.resolve()
let presentationRevision = 0
function presentBrowser(accountId?: string, bounds?: Bounds) {
  const revision = ++presentationRevision
  presentation = presentation
    .then(async () => {
      if (revision !== presentationRevision) return
      if (accountId) await invoke('browser_show', { accountId, bounds })
      else await invoke('browser_hide')
      const task = accountId
        ? useCommerce.getState().tasks[accountId]
        : undefined
      const logs =
        task?.kind === 'collect' &&
        task.logs?.some((entry) => entry.level === 'error')
      await invoke('overlay_sync', {
        accountId: logs ? accountId : null,
        bounds: logs ? bounds : null,
        task: logs ? task : null,
      })
    })
    .catch((e) => {
      if (revision !== presentationRevision) return
      const error = browserError(e)
      if (accountId) setGuestState(accountId, { status: 'error', error })
      toast.error(error)
    })
}

const coveringLayers = [
  'dialog-content',
  'sheet-content',
  'alert-dialog-content',
  'dropdown-menu-content',
  'select-content',
  'popover-content',
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(',')

export function BrowserLayer() {
  const state = useBrowser()
  const accounts = useCommerce((s) => s.accounts)
  const task = useCommerce((s) => s.tasks[state.active])
  const session = useGuestState((s) => s.sessions[state.active])
  const attempt = useGuestState((s) => s.attempts[state.active] || 0)
  useLayoutEffect(() => {
    if (!desktop) return
    const checkLayers = () => {
      // Keep the page hidden through Radix's closing animation as well.
      const covered = Boolean(document.querySelector(coveringLayers))
      if (covered !== useBrowser.getState().covered) {
        useBrowser.setState({ covered })
        if (covered) presentBrowser()
      }
    }
    const observer = new MutationObserver(checkLayers)
    observer.observe(document.body, { childList: true, subtree: true })
    checkLayers()
    return () => {
      observer.disconnect()
      presentBrowser()
    }
  }, [])
  useLayoutEffect(() => {
    if (!desktop) return
    const visible =
      state.active &&
      accounts.some((a) => a.id === state.active) &&
      state.prepared[state.active] === attempt &&
      !state.covered &&
      session?.status !== 'error' &&
      state.bounds.width > 0 &&
      state.bounds.height > 0
    presentBrowser(visible ? state.active : undefined, state.bounds)
  }, [state, accounts, session?.status, attempt, task])
  if (!desktop) return null
  return accounts
    .filter((a) => state.visited.includes(a.id))
    .map((account) => <PlatformGuest key={account.id} account={account} />)
}
