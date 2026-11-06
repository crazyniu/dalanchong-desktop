import { useEffect, useEffectEvent, useLayoutEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
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
import {
  CollectionToolbar,
  type ToolbarAction,
  type ToolbarState,
} from './collection-toolbar'
import { desktop } from './desktop'
import type {
  InviteProgressAction,
  InviteProgressState,
  TaskOverlayContent,
} from './invite-progress'
import { useCommerce } from './store'
import type { Account } from './types'

type Bounds = { left: number; top: number; width: number; height: number }
const useBrowser = create<{
  active: string
  visited: string[]
  prepared: Record<string, number>
  covered: boolean
  bounds: Bounds
  toolbar: ToolbarState | null
  inviteProgress: InviteProgressState | null
}>(() => ({
  active: '',
  visited: [],
  prepared: {},
  covered: false,
  bounds: { left: 0, top: 0, width: 0, height: 0 },
  toolbar: null,
  inviteProgress: null,
}))

export function useNativeInviteProgress(
  state: InviteProgressState | null,
  onAction: (action: InviteProgressAction) => void
) {
  const handleAction = useEffectEvent(
    (event: { platform: string; action: InviteProgressAction }) => {
      if (event.platform === state?.platform) onAction(event.action)
    }
  )
  useEffect(() => {
    if (!desktop) return
    const subscription = listen<{
      platform: string
      action: InviteProgressAction
    }>('assistant:invite-progress-action', ({ payload }) =>
      handleAction(payload)
    )
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    if (desktop) useBrowser.setState({ inviteProgress: state })
  }, [state])
  useLayoutEffect(
    () => () => {
      if (desktop) useBrowser.setState({ inviteProgress: null })
    },
    []
  )
}

export function FloatingToolbar({
  state,
  onAction,
}: {
  state: ToolbarState
  onAction: (action: ToolbarAction) => void
}) {
  const handleAction = useEffectEvent(
    (event: { accountId: string; action: ToolbarAction }) => {
      if (event.accountId === state.accountId) onAction(event.action)
    }
  )
  useEffect(() => {
    if (!desktop) return
    const subscription = listen<{ accountId: string; action: ToolbarAction }>(
      'assistant:toolbar-action',
      ({ payload }) => handleAction(payload)
    )
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    if (desktop) useBrowser.setState({ toolbar: state })
  }, [state])
  useLayoutEffect(
    () => () => {
      if (desktop) useBrowser.setState({ toolbar: null })
    },
    []
  )
  return (
    <div className='floating-toolbar'>
      <CollectionToolbar state={state} onAction={onAction} />
    </div>
  )
}

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
      let nativeBounds = bounds
      if (accountId && bounds) {
        const windowHandle = getCurrentWindow()
        const [size, scale] = await Promise.all([
          windowHandle.innerSize(),
          windowHandle.scaleFactor(),
        ])
        if (revision !== presentationRevision) return
        // macOS includes the title-bar inset in the native view, but not the DOM viewport.
        nativeBounds = {
          ...bounds,
          top: bounds.top + size.toLogical(scale).height - window.innerHeight,
        }
        await invoke('browser_show', { accountId, bounds: nativeBounds })
      } else await invoke('browser_hide')
      const task = accountId
        ? useCommerce.getState().tasks[accountId]
        : undefined
      const logs =
        task?.kind === 'collect' &&
        task.logs?.some((entry) => entry.level === 'error')
      const progress = useBrowser.getState().inviteProgress
      const overlay: TaskOverlayContent | null = progress
        ? { kind: 'invite', ...progress }
        : logs
          ? { kind: 'collect', task }
          : null
      await invoke('overlay_sync', {
        accountId: overlay ? accountId : null,
        bounds:
          overlay && nativeBounds
            ? { ...nativeBounds, height: nativeBounds.height - 88 }
            : null,
        task: overlay,
      })
      const toolbar = useBrowser.getState().toolbar
      await invoke('toolbar_sync', {
        bounds: accountId ? nativeBounds : null,
        state: accountId === toolbar?.accountId ? toolbar : null,
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
