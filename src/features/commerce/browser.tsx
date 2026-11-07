/**
 * AI module map
 * Purpose: align native account WebViews and floating child views with React layout.
 * Entry: BrowserHost/BrowserLayer own page placement; FloatingToolbar and
 * GlobalInviteProgress synchronize native overlays. openBrowserDialog completes
 * native covering before mounting toolbar dialogs. The DOM toolbar owns preview
 * drag offsets; toolbar.rs owns the desktop toolbar position across hide/show cycles.
 * Flow: prepare each account once per retry attempt, measure DOM bounds, call native
 * show/hide commands, and forward child-view actions to the owning page callbacks.
 * State: the local browser store tracks active/visited accounts, bounds, prepared attempts,
 * and overlay payloads; preparations coalesces concurrent invitation account setup.
 * Removed accounts release these presentation caches. Invitation overlay snapshots
 * project display counters/current text, without task diagnostics or filter payloads.
 * Global invitation feedback includes both platforms and persists above dialogs and
 * routes with a stable native presentation key; collection feedback follows the account.
 * Task snapshots are keyed by account and kind; progress actions stop invitations only.
 * Invariants: native WebViews paint above DOM. Covering surfaces retain an in-memory image
 * of the visible page before hiding it, then restore the native page when they close.
 * Snapshots never persist or receive input. Keep loading pages hidden until ready and
 * never equate layout state with authorization. Serialize native presentation changes;
 * coordinate payloads with browser.rs/browser_snapshot.rs/toolbar.rs/overlay.rs.
 */

import { memo, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef } from 'react'
import { createPortal, flushSync } from 'react-dom'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toast } from 'sonner'
import { create } from 'zustand'
import { shallow } from 'zustand/shallow'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/loading-state'
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
import type { Account, Task } from './types'
import {
  InviteProgress,
  type InviteProgressAction,
  type InviteProgressState,
  type TaskOverlayContent,
} from './invite-progress'
import { stopDemo, useCommerce } from './store'

type Bounds = { left: number; top: number; width: number; height: number }
export type NativeToolbarState = ToolbarState
const useBrowser = create<{
  active: string
  visited: string[]
  prepared: Record<string, number>
  covered: boolean
  snapshot: { accountId: string; image: string } | null
  bounds: Bounds
  viewport: Bounds | null
  toolbar: NativeToolbarState | null
  inviteProgress: InviteProgressState | null
}>(() => ({
  active: '',
  visited: [],
  prepared: {},
  covered: false,
  snapshot: null,
  bounds: { left: 0, top: 0, width: 0, height: 0 },
  viewport: null,
  toolbar: null,
  inviteProgress: null,
}))

function GlobalInviteProgress() {
  const accounts = useCommerce((s) => s.accounts)
  const tasks = useCommerce(useShallow((s) => accounts
    .map((account) => s.tasks[`${account.id}:invite`])
    .filter((task) => task?.kind === 'invite' && task.status === 'running')
  ))
  const progress = useMemo<InviteProgressState | null>(() => tasks.length
    ? {
        tasks: tasks.map((task) => {
          const account = accounts.find((account) => account.id === task.accountId)!
          return { name: account.name, platform: account.platform, task }
        }),
      }
    : null, [tasks, accounts])
  async function onAction({ accountId }: InviteProgressAction) {
    try {
      if (desktop) await desktop.stop(accountId, 'invite')
      else stopDemo(accountId, 'invite')
    } catch (error) {
      toast.error(browserError(error))
    }
  }
  useNativeInviteProgress(progress, onAction)
  if (desktop || !progress) return null
  return createPortal(
    <InviteProgress
      state={progress}
      onAction={onAction}
      className='pointer-events-auto fixed bottom-26 z-[100]'
    />,
    document.body
  )
}

function useNativeInviteProgress(
  state: InviteProgressState | null,
  onAction: (action: InviteProgressAction) => void
) {
  const handleAction = useEffectEvent(
    (event: { action: InviteProgressAction }) => {
      if (state?.tasks.some(({ task }) => task.accountId === event.action.accountId)) {
        onAction(event.action)
      }
    }
  )
  useEffect(() => {
    if (!desktop) return
    const subscription = listen<{
      action: InviteProgressAction
    }>('assistant:invite-progress-action', ({ payload }) =>
      handleAction(payload)
    )
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    if (!desktop) return
    const previous = useBrowser.getState().inviteProgress
    if (previous === state) return
    if (previous && state &&
        previous.tasks.length === state.tasks.length &&
        previous.tasks.every((entry, index) => {
          const next = state.tasks[index]
          return entry.name === next.name &&
            entry.platform === next.platform &&
            entry.task.accountId === next.task.accountId &&
            entry.task.startedAt === next.task.startedAt &&
            entry.task.processed === next.task.processed &&
            entry.task.total === next.task.total &&
            entry.task.success === next.task.success &&
            entry.task.skipped === next.task.skipped &&
            entry.task.failed === next.task.failed &&
            entry.task.review === next.task.review &&
            entry.task.current === next.task.current
        })) return
    useBrowser.setState({
      inviteProgress: state && {
        tasks: state.tasks.map(({ name, platform, task }) => ({
          name,
          platform,
          task: {
            accountId: task.accountId,
            startedAt: task.startedAt,
            processed: task.processed,
            total: task.total,
            success: task.success,
            skipped: task.skipped,
            failed: task.failed,
            review: task.review,
            current: task.current,
          },
        })),
      },
    })
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
  useNativeToolbar(state, onAction)
  const ref = useRef<HTMLDivElement>(null)
  const offset = useRef({ x: 0, y: 0 })
  function move(deltaX: number, deltaY: number) {
    const bar = ref.current!
    const workspace = bar.parentElement!.querySelector<HTMLElement>(
      '[data-testid="platform-workspace"]'
    )!
    const bounds = workspace.getBoundingClientRect()
    const rect = bar.getBoundingClientRect()
    offset.current = {
      x:
        offset.current.x +
        Math.max(
          bounds.left + 16 - rect.left,
          Math.min(deltaX, bounds.right - 16 - rect.right)
        ),
      y:
        offset.current.y +
        Math.max(
          bounds.top + 16 - rect.top,
          Math.min(deltaY, bounds.bottom - 16 - rect.bottom)
        ),
    }
    bar.style.translate = `${offset.current.x}px ${offset.current.y}px`
  }
  useLayoutEffect(() => {
    if (desktop) return
    const resize = new ResizeObserver(() => move(0, 0))
    resize.observe(ref.current!.parentElement!)
    resize.observe(ref.current!)
    return () => resize.disconnect()
  }, [])
  if (desktop) return null
  return (
    <div ref={ref} className='floating-toolbar'>
      <CollectionToolbar state={state} onAction={onAction} onMove={move} />
    </div>
  )
}

function useNativeToolbar<Action>(state: NativeToolbarState, onAction: (action: Action) => void) {
  const handleAction = useEffectEvent(
    (event: { accountId: string; action: Action }) => {
      if (event.accountId === state.accountId) onAction(event.action)
    }
  )
  useEffect(() => {
    if (!desktop) return
    const subscription = listen<{ accountId: string; action: Action }>(
      'assistant:toolbar-action',
      ({ payload }) => handleAction(payload)
    )
    return () => {
      void subscription.then((unsubscribe) => unsubscribe())
    }
  }, [])
  useLayoutEffect(() => {
    if (desktop && !shallow(useBrowser.getState().toolbar, state)) {
      useBrowser.setState({ toolbar: state })
    }
  }, [state])
  useLayoutEffect(
    () => () => {
      if (desktop) useBrowser.setState({ toolbar: null })
    },
    []
  )
}

export function BrowserHost({ account }: { account: Account }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useGuestState((s) => s.sessions[account.id])
  const snapshot = useBrowser((s) => s.snapshot)
  useLayoutEffect(() => {
    const host = ref.current!
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
    let frame = 0
    const scheduleMeasure = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    const observer = new ResizeObserver(scheduleMeasure)
    const onScroll = (event: Event) => {
      const target = event.target
      // Only scrolling an ancestor moves this host; log/table scrolls do not.
      if (target === document || target === window ||
          (target instanceof Element && target.contains(host))) scheduleMeasure()
    }
    observer.observe(host)
    window.addEventListener('resize', scheduleMeasure)
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    measure()
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleMeasure)
      window.removeEventListener('scroll', onScroll, true)
      useBrowser.setState({ active: '' })
      presentBrowser()
    }
  }, [account.id])
  return (
    <div ref={ref} className='relative min-h-0 flex-1 bg-white'>
      {snapshot?.accountId === account.id && (
        <img
          src={snapshot.image}
          alt=''
          aria-hidden='true'
          draggable={false}
          className='pointer-events-none absolute inset-0 size-full object-fill'
        />
      )}
      {(!state || state.status === 'loading') && (
        <LoadingState
          label='正在加载网页…'
          className='absolute inset-0 bg-white'
        />
      )}
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
const PlatformGuest = memo(function PlatformGuest({ account }: { account: Account }) {
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
})

// Serialize native visibility changes so a slow show cannot outlive a later hide.
let presentation = Promise.resolve()
let presentationRevision = 0
let presentedAccount: string | undefined
let nativeCovered = false
let overlayNeedsRaise = false
// Keep geometry and payload snapshots separate: a progress tick does not move or
// reveal the native page, and unchanged controls do not cross the IPC bridge.
let lastBrowser: {
  accountId?: string
  bounds?: Bounds
  nativeBounds?: Bounds
  visible: boolean
} | undefined
let lastOverlay: {
  accountId?: string
  bounds?: Bounds
  content: Task | InviteProgressState | null
} | undefined
let lastToolbar: { bounds?: Bounds; state: NativeToolbarState | null } | undefined

async function syncTaskOverlay(accountId?: string, bounds?: Bounds) {
  const { inviteProgress, viewport } = useBrowser.getState()
  const task = accountId ? useCommerce.getState().tasks[`${accountId}:collect`] : undefined
  const collection = task?.kind === 'collect' &&
    (task.status === 'running' || Boolean(task.activity?.length) ||
      Boolean(task.logs?.some((entry) => entry.level === 'error')))
  const overlay: TaskOverlayContent | null = inviteProgress && viewport
    ? { kind: 'invite', ...inviteProgress }
    : collection ? { kind: 'collect', task } : null
  // Invitation identity and geometry belong to the window, not the selected account.
  // Keeping this key stable avoids hiding the native card across routes and dialogs.
  const overlayAccount = overlay?.kind === 'invite'
    ? 'invite-progress'
    : overlay ? accountId : undefined
  // Keep the card at the window's bottom right across dialogs and toolbar drags.
  // The native card adds a 16px inset to the 88px bottom toolbar clearance.
  const overlayBounds = overlay?.kind === 'invite' && viewport
    ? { ...viewport, height: viewport.height - 88 }
    : overlay && bounds ? { ...bounds, height: bounds.height - 88 } : undefined
  const content = overlay?.kind === 'invite'
    ? inviteProgress
    : overlay?.kind === 'collect' ? overlay.task : null
  if (!lastOverlay || lastOverlay.accountId !== overlayAccount ||
      !shallow(lastOverlay.bounds, overlayBounds) || lastOverlay.content !== content || overlayNeedsRaise) {
    await invoke('overlay_sync', {
      accountId: overlayAccount ?? null,
      bounds: overlayBounds ?? null,
      task: overlay,
      raise: overlayNeedsRaise,
    })
    lastOverlay = { accountId: overlayAccount, bounds: overlayBounds, content }
    overlayNeedsRaise = false
  }
}

async function coverNativeBrowser() {
  if (nativeCovered) {
    await syncTaskOverlay()
    return
  }
  const snapshotAccount = presentedAccount
  const background = snapshotAccount
    ? invoke<string>('browser_snapshot', { accountId: snapshotAccount })
        .then(async (image) => {
          const decoded = new Image()
          decoded.src = image
          await decoded.decode()
          if (useBrowser.getState().active === snapshotAccount) {
            // Commit the decoded backdrop while the native page still covers it.
            flushSync(() =>
              useBrowser.setState({
                snapshot: { accountId: snapshotAccount, image },
              })
            )
          }
        })
        .catch((error) => {
          toast.error(`无法保留网页背景：${browserError(error)}`)
        })
    : Promise.resolve()
  // Keep invitation feedback above the dialog while hiding account-local controls.
  // The snapshot captures only the account page. Hide it after the decoded backdrop
  // commits; browser_hide acknowledges UI-thread execution before the dialog mounts.
  await Promise.all([
    background,
    syncTaskOverlay(),
    invoke('toolbar_sync', { bounds: null, state: null }),
  ])
  await invoke('browser_hide')
  presentedAccount = undefined
  nativeCovered = true
  lastBrowser = undefined
  lastToolbar = undefined
}

export function openBrowserDialog(open: () => void) {
  if (!desktop) {
    open()
    return
  }
  // Keep this transaction in the visibility queue without revision cancellation:
  // task/toolbar updates may supersede layout requests, but cannot open the dialog
  // before covering finishes or restore a native view between hide and DOM commit.
  presentation = presentation
    .then(async () => {
      await coverNativeBrowser()
      flushSync(open)
    })
    .catch((error) => {
      toast.error(`打开弹框失败：${browserError(error)}`)
    })
  return presentation
}

function presentBrowser(accountId?: string, bounds?: Bounds, visible = true) {
  const revision = ++presentationRevision
  presentation = presentation
    .then(async () => {
      if (revision !== presentationRevision) return
      // Portals can mount before React commits the observer's covered-state update.
      const covered = Boolean(document.querySelector(coveringLayers))
      if (covered) {
        // Complete the covering transaction even when a newer layout request arrives.
        // That queued request decides whether the page needs to be restored afterward.
        await coverNativeBrowser()
        return
      }
      nativeCovered = false
      const nativeAccountId = accountId
      const browserChanged = !lastBrowser ||
        lastBrowser.accountId !== nativeAccountId ||
        lastBrowser.bounds !== bounds || lastBrowser.visible !== visible
      let nativeBounds = lastBrowser && lastBrowser.bounds === bounds
        ? lastBrowser.nativeBounds
        : bounds
      if (browserChanged && nativeAccountId && bounds) {
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
        await invoke('browser_show', {
          accountId: nativeAccountId,
          bounds: nativeBounds,
          visible,
        })
        // Retain the reorder request if a newer presentation supersedes this one
        // before overlay synchronization; the newly shown sibling may cover the card.
        if (visible) overlayNeedsRaise = true
        presentedAccount = visible ? nativeAccountId : undefined
        lastBrowser = { accountId: nativeAccountId, bounds, nativeBounds, visible }
      } else if (browserChanged) {
        await invoke('browser_hide')
        presentedAccount = undefined
        lastBrowser = { accountId: nativeAccountId, bounds, nativeBounds, visible }
      }
      if (revision !== presentationRevision) return
      if (useBrowser.getState().snapshot) {
        useBrowser.setState({ snapshot: null })
      }
      const shownAccountId = visible ? nativeAccountId : undefined
      const toolbar = useBrowser.getState().toolbar
      const toolbarState = shownAccountId === toolbar?.accountId ? toolbar : null
      const toolbarBounds = shownAccountId ? nativeBounds : undefined
      if (!lastToolbar || lastToolbar.bounds !== toolbarBounds || lastToolbar.state !== toolbarState) {
        const toolbarRevealed = toolbarState && lastToolbar?.state?.accountId !== toolbarState.accountId
        await invoke('toolbar_sync', {
          bounds: toolbarBounds ?? null,
          state: toolbarState,
        })
        if (toolbarRevealed) overlayNeedsRaise = true
        lastToolbar = { bounds: toolbarBounds, state: toolbarState }
      }
      if (revision !== presentationRevision) return
      await syncTaskOverlay(shownAccountId, nativeBounds)
    })
    .catch((e) => {
      if (revision !== presentationRevision) return
      const error = browserError(e)
      if (accountId) setGuestState(accountId, { status: 'error', error })
      toast.error(error)
    })
}

// DOM z-index cannot cover a native child WebView. Keep its captured appearance behind
// these portaled surfaces while the actual view is hidden, including closing animations.
const coveringLayers = [
  'dialog-content',
  'sheet-content',
  'alert-dialog-content',
  'dropdown-menu-content',
  'context-menu-content',
  'select-content',
  'popover-content',
]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(',')

export function BrowserLayer() {
  const state = useBrowser()
  const accounts = useCommerce((s) => s.accounts)
  const task = useCommerce((s) => s.tasks[`${state.active}:collect`])
  const session = useGuestState((s) => s.sessions[state.active])
  const attempt = useGuestState((s) => s.attempts[state.active] || 0)
  useEffect(() => {
    const accountIds = new Set(accounts.map((account) => account.id))
    // Native account removal owns the actual WebView. Drop its presentation caches
    // too, so repeated account creation/removal does not retain resolved setup or images.
    for (const id of preparations.keys()) {
      if (!accountIds.has(id)) preparations.delete(id)
    }
    useBrowser.setState((current) => {
      const visited = current.visited.filter((id) => accountIds.has(id))
      const prepared = Object.fromEntries(Object.entries(current.prepared)
        .filter(([id]) => accountIds.has(id)))
      const snapshot = current.snapshot && accountIds.has(current.snapshot.accountId)
        ? current.snapshot : null
      const active = accountIds.has(current.active) ? current.active : ''
      if (visited.length === current.visited.length &&
          Object.keys(prepared).length === Object.keys(current.prepared).length &&
          snapshot === current.snapshot && active === current.active) return current
      return { visited, prepared, snapshot, active }
    })
    useGuestState.setState((current) => {
      const sessions = Object.fromEntries(Object.entries(current.sessions)
        .filter(([id]) => accountIds.has(id)))
      const attempts = Object.fromEntries(Object.entries(current.attempts)
        .filter(([id]) => accountIds.has(id)))
      if (Object.keys(sessions).length === Object.keys(current.sessions).length &&
          Object.keys(attempts).length === Object.keys(current.attempts).length) return current
      return { sessions, attempts }
    })
  }, [accounts])
  useLayoutEffect(() => {
    if (!desktop) return
    const windowHandle = getCurrentWindow()
    const measure = async () => {
      const [size, scale] = await Promise.all([
        windowHandle.innerSize(),
        windowHandle.scaleFactor(),
      ])
      useBrowser.setState({
        viewport: {
          left: 0,
          top: size.toLogical(scale).height - window.innerHeight,
          width: window.innerWidth,
          height: window.innerHeight,
        },
      })
    }
    const onResize = () => { void measure().catch((error) => toast.error(browserError(error))) }
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  useLayoutEffect(() => {
    if (!desktop) return
    const checkLayers = () => {
      // Retain the background through Radix's closing animation as well.
      const covered = Boolean(document.querySelector(coveringLayers))
      if (covered !== useBrowser.getState().covered) {
        useBrowser.setState({ covered })
      }
      if (covered) presentBrowser()
    }
    const observer = new MutationObserver((mutations) => {
      const affectsLayers = mutations.some(({ target, addedNodes, removedNodes }) => {
        // A table update inside an existing modal cannot uncover the native page.
        // Portal removal is observed at its parent and still reaches checkLayers.
        if (target instanceof Element && target.closest(coveringLayers)) return false
        return [...addedNodes, ...removedNodes].some((node) =>
          node instanceof Element &&
          (node.matches(coveringLayers) || node.querySelector(coveringLayers))
        )
      })
      if (affectsLayers) checkLayers()
    })
    observer.observe(document.body, { childList: true, subtree: true })
    checkLayers()
    return () => {
      observer.disconnect()
      presentBrowser()
    }
  }, [])
  useLayoutEffect(() => {
    if (!desktop) return
    const prepared =
      state.active &&
      accounts.some((a) => a.id === state.active) &&
      state.prepared[state.active] === attempt &&
      session?.status !== 'error' &&
      state.bounds.width > 0 &&
      state.bounds.height > 0
    presentBrowser(
      prepared ? state.active : undefined,
      state.bounds,
      session?.status === 'ready'
    )
  }, [
    state.active,
    state.bounds,
    state.viewport,
    state.covered,
    state.prepared,
    state.toolbar,
    state.inviteProgress,
    accounts,
    session?.status,
    attempt,
    task,
  ])
  return (
    <>
      <GlobalInviteProgress />
      {desktop && accounts
        .filter((a) => state.visited.includes(a.id))
        .map((account) => <PlatformGuest key={account.id} account={account} />)}
    </>
  )
}
