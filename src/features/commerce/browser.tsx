import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { WebviewTag } from 'electron'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  guests,
  urls,
  browserError,
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
  bounds: Bounds
}>(() => ({
  active: '',
  visited: [],
  bounds: { left: 0, top: 0, width: 0, height: 0 },
}))
export function BrowserHost({ account }: { account: Account }) {
  const ref = useRef<HTMLDivElement>(null)
  const state = useGuestState((s) => s.sessions[account.id])
  useLayoutEffect(() => {
    useBrowser.setState((s) => ({
      active: account.id,
      visited: s.visited.includes(account.id)
        ? s.visited
        : [...s.visited, account.id],
    }))
    const measure = () => {
      const r = ref.current!.getBoundingClientRect()
      useBrowser.setState({
        bounds: { left: r.left, top: r.top, width: r.width, height: r.height },
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(ref.current!)
    window.addEventListener('scroll', measure, true)
    measure()
    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', measure, true)
      useBrowser.setState({ active: '' })
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
function PlatformGuest({
  account,
  active,
  bounds,
}: {
  account: Account
  active: boolean
  bounds: Bounds
}) {
  const ref = useRef<WebviewTag>(null)
  const attempt = useGuestState((s) => s.attempts[account.id] || 0)
  const attachGuest = useCallback(
    (element: WebviewTag | null) => {
      ref.current = element
      if (!element) return
      // Set the native attribute before navigation; React drops unknown boolean attributes.
      element.setAttribute('allowpopups', '')
      element.src = urls[account.platform]
    },
    [account.platform]
  )
  const [preparedAttempt, setPreparedAttempt] = useState<number | null>(null)
  const ready = preparedAttempt === attempt
  useEffect(() => {
    let mounted = true
    setGuestState(account.id, { status: 'loading' })
    desktop!
      .prepareAccount({ id: account.id, platform: account.platform })
      .then(() => {
        if (mounted) setPreparedAttempt(attempt)
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
  useEffect(() => {
    if (!ready) return
    const element = ref.current!
    let navigation = 0
    const bind = async () => {
      const current = navigation
      try {
        await desktop!.bindGuest(account.id, element.getWebContentsId())
        if (navigation !== current) return
        guests.set(account.id, element)
        setGuestState(account.id, { status: 'ready' })
      } catch (e) {
        if (navigation !== current) return
        const error = browserError(e)
        setGuestState(account.id, { status: 'error', error })
        toast.error(error)
      }
    }
    const loading = (event: Event) => {
      const e = event as Event & { isMainFrame: boolean; isInPlace: boolean }
      if (e.isMainFrame && !e.isInPlace) {
        navigation++
        guests.delete(account.id)
        setGuestState(account.id, { status: 'loading' })
      }
    }
    const fail = (event: Event) => {
      const e = event as Event & {
        errorCode: number
        isMainFrame: boolean
        errorDescription: string
      }
      if (e.isMainFrame && e.errorCode !== -3) {
        navigation++
        guests.delete(account.id)
        setGuestState(account.id, {
          status: 'error',
          error: `网页加载失败：${e.errorDescription}`,
        })
        toast.error(`网页加载失败：${e.errorDescription}`)
      }
    }
    const gone = () => {
      navigation++
      guests.delete(account.id)
      setGuestState(account.id, {
        status: 'error',
        error: '网页已关闭，请重新打开',
      })
    }
    element.addEventListener('dom-ready', bind)
    element.addEventListener('did-start-navigation', loading)
    element.addEventListener('did-fail-load', fail)
    element.addEventListener('render-process-gone', gone)
    return () => {
      navigation++
      element.removeEventListener('dom-ready', bind)
      element.removeEventListener('did-start-navigation', loading)
      element.removeEventListener('did-fail-load', fail)
      element.removeEventListener('render-process-gone', gone)
      guests.delete(account.id)
    }
  }, [ready, account.id, attempt])
  if (!ready) return null
  return (
    <webview
      key={attempt}
      ref={attachGuest}
      partition={account.sessionId}
      webpreferences='contextIsolation=yes,sandbox=yes,backgroundThrottling=no'
      style={{
        position: 'fixed',
        zIndex: 10,
        ...bounds,
        display: active ? 'flex' : 'none',
        background: '#fff',
      }}
      aria-label={`${account.name}平台网页`}
    />
  )
}
export function BrowserLayer() {
  const state = useBrowser()
  const accounts = useCommerce((s) => s.accounts)
  if (!desktop) return null
  return (
    <>
      {accounts
        .filter((a) => state.visited.includes(a.id))
        .map((account) => (
          <PlatformGuest
            key={account.id}
            account={account}
            active={state.active === account.id}
            bounds={state.bounds}
          />
        ))}
    </>
  )
}
