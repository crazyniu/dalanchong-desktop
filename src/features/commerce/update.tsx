/**
 * AI module map
 * Purpose: display installed version, release notes, and the one-click update lifecycle.
 * Entry: UpdateStatus appears under the app title and consumes native update events.
 * Flow: show a scrollable Markdown release dialog once per offered version, initiate
 * desktop.applyUpdate, and render check/download/wait/install errors. Native Tasks also
 * waits for work owned by the separate video browser before installing.
 * State: local open/dismissal/action state complements the native UpdateState snapshot.
 * Markdown loads only for visible release notes and reuses parsed content across progress ticks.
 * Invariants: checking is allowed at startup; download/install requires a user action.
 * The runtime/native updater owns saving, signature checks, task exclusion, and restart;
 * the UI must not bypass those stages or install a manually opened download.
 */

import { lazy, memo, Suspense, useEffect, useRef, useState } from 'react'
import {
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import { LoadingState } from '@/components/ui/loading-state'
import { desktop, type UpdateState } from './desktop'

declare const __APP_VERSION__: string

const Markdown = memo(lazy(() => import('react-markdown')))

type UpdateAction = 'check' | 'update'

function errorText(error: unknown) {
  return (error as Error).message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  )
}

export function UpdateStatus() {
  const [state, setState] = useState<UpdateState>({
    currentVersion: __APP_VERSION__,
    status: 'idle',
    canInstall: false,
  })
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<UpdateAction | null>(null)
  const promptedVersion = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!desktop) return
    function receiveState(next: UpdateState) {
      setState(next)
      if (
        next.status === 'available' &&
        next.version !== promptedVersion.current
      ) {
        promptedVersion.current = next.version
        setOpen(true)
      }
    }
    const unsubscribe = desktop.onEvent((event) => {
      if (event.type === 'update') receiveState(event.state)
    })
    desktop
      .getUpdateState()
      .then(receiveState)
      .catch((error) => {
        setState((current) => ({
          ...current,
          status: 'error',
          error: errorText(error),
        }))
      })
    return unsubscribe
  }, [])

  async function run(action: UpdateAction) {
    if (!desktop) return
    setBusy(action)
    if (action === 'check') {
      setState((current) => ({
        ...current,
        status: 'checking',
        error: undefined,
      }))
    } else {
      setState((current) => ({
        ...current,
        status: 'downloading',
        percent: 0,
        error: undefined,
        retryAction: 'update',
      }))
    }
    try {
      const result =
        action === 'check'
          ? await desktop.checkForUpdates()
          : await desktop.applyUpdate()
      setState(result)
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: errorText(error),
        retryAction: action,
      }))
    } finally {
      setBusy(null)
    }
  }

  function showUpdates() {
    setOpen(true)
    if (
      desktop &&
      (state.status === 'idle' || state.status === 'not-available')
    ) {
      void run('check')
    }
  }

  const checking = state.status === 'checking'
  const downloading = state.status === 'downloading'
  const available = state.status === 'available'
  const downloaded = state.status === 'downloaded'
  const waiting = state.status === 'waiting'
  const installing = state.status === 'installing'
  const updating = downloading || downloaded || waiting || installing
  const percent = Math.round(state.percent ?? 0)
  const progressLabel = installing
    ? '正在安装，即将重启'
    : waiting
      ? '任务结束后自动安装并重启'
      : downloaded
        ? '正在准备安装'
        : percent === 100
          ? '正在校验更新'
          : `正在下载 ${percent}%`
  const updateLabel = available
    ? '发现新版本'
    : updating
      ? progressLabel
      : checking
        ? '正在检查'
        : '检查更新'

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        aria-label={`检查更新，当前版本 ${__APP_VERSION__}`}
        title={updateLabel}
        className={`h-6 justify-start gap-2 px-0 text-sm font-normal tabular-nums hover:bg-transparent ${available || updating ? 'text-emerald-700 hover:text-emerald-800' : 'text-muted-foreground hover:text-foreground'}`}
        onClick={showUpdates}
      >
        v{__APP_VERSION__}
        {(available || updating) && (
          <span
            className='size-1.5 rounded-full bg-emerald-600'
            aria-label={updateLabel}
          />
        )}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={!installing}
          className='max-h-[85vh] overflow-y-auto sm:max-w-[480px]'
        >
          <DialogHeader>
            <DialogTitle>{available ? '发现新版本' : '软件更新'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-5 py-2'>
            <dl className='grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm'>
              <dt className='text-muted-foreground'>当前版本</dt>
              <dd className='text-right tabular-nums'>
                v{state.currentVersion}
              </dd>
              {state.version && (
                <>
                  <dt className='text-muted-foreground'>最新版本</dt>
                  <dd className='text-right tabular-nums'>v{state.version}</dd>
                </>
              )}
            </dl>
            {!desktop ? (
              <p className='text-sm text-muted-foreground'>
                请在桌面版中检查更新
              </p>
            ) : (
              <>
                {checking && <LoadingState label='正在检查更新…' />}
                {state.status === 'not-available' && (
                  <p
                    role='status'
                    className='flex items-center gap-2 text-sm text-emerald-700'
                  >
                    <Check className='size-4' />
                    已是最新版本
                  </p>
                )}
                {state.releaseNotes && (
                  <section className='space-y-2'>
                    <h3 className='text-sm font-medium'>更新内容</h3>
                    <div className='max-h-64 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-3 text-sm leading-6 break-words [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5'>
                      <Suspense fallback={<LoadingState label='正在加载更新内容…' />}>
                        <Markdown skipHtml>{state.releaseNotes}</Markdown>
                      </Suspense>
                    </div>
                  </section>
                )}
                {downloading && (
                  <LoadingState label={progressLabel}>
                    <Progress
                      value={state.percent ?? 0}
                      aria-label='更新下载进度'
                      className='max-w-64'
                    />
                  </LoadingState>
                )}
                {(waiting || downloaded || installing) && (
                  <LoadingState label={progressLabel} />
                )}
                {(available || downloading) && state.canInstall && (
                  <p className='text-center text-sm text-muted-foreground'>
                    更新完成后自动重启
                  </p>
                )}
                {state.status === 'error' && (
                  <p
                    role='alert'
                    className='rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm break-words whitespace-pre-wrap text-destructive'
                  >
                    {state.error}
                  </p>
                )}
              </>
            )}
          </div>
          {desktop && (
            <DialogFooter>
              {available ? (
                <>
                  <Button variant='outline' onClick={() => setOpen(false)}>
                    稍后
                  </Button>
                  <Button
                    disabled={!state.canInstall || Boolean(busy)}
                    onClick={() => run('update')}
                  >
                    <Download />
                    {state.canInstall ? '立即更新' : '开发版无法更新'}
                  </Button>
                </>
              ) : updating ? (
                <Button disabled>
                  <LoaderCircle className='animate-spin' />
                  {waiting ? '等待任务结束' : installing ? '正在安装' : '正在更新'}
                </Button>
              ) : state.status === 'error' ? (
                <Button
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run(state.canInstall ? (state.retryAction ?? 'check') : 'check')
                  }
                >
                  <RefreshCw />
                  重试
                </Button>
              ) : (
                <Button
                  disabled={checking || Boolean(busy)}
                  onClick={() => run('check')}
                >
                  {checking ? (
                    <LoaderCircle className='animate-spin' />
                  ) : (
                    <RefreshCw />
                  )}
                  {checking ? '正在检查' : '检查更新'}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
