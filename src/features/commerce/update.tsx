import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import {
  Check,
  Download,
  LoaderCircle,
  RefreshCw,
  RotateCw,
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
import { desktop, type UpdateState } from './desktop'

declare const __APP_VERSION__: string

type UpdateAction = 'check' | 'download' | 'install'

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
  const [lastAction, setLastAction] = useState<UpdateAction>('check')
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
    setLastAction(action)
    if (action === 'check') {
      setState((current) => ({
        ...current,
        status: 'checking',
        error: undefined,
      }))
    } else if (action === 'download') {
      setState((current) => ({
        ...current,
        status: 'downloading',
        percent: 0,
        error: undefined,
      }))
    }
    try {
      const result =
        action === 'check'
          ? await desktop.checkForUpdates()
          : action === 'download'
            ? await desktop.downloadUpdate()
            : await desktop.installUpdate()
      setState(result)
    } catch (error) {
      setState((current) => ({
        ...current,
        status: 'error',
        error: errorText(error),
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
  const percent = Math.round(state.percent ?? 0)
  const footerLabel = available
    ? '发现新版本'
    : downloaded
      ? '重启安装'
      : downloading
        ? `下载中 ${percent}%`
        : checking
          ? '正在检查'
          : '检查更新'

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        aria-label={`检查更新，当前版本 ${__APP_VERSION__}`}
        title={footerLabel}
        className={`h-8 px-0 text-sm font-normal tabular-nums hover:bg-transparent ${available || downloaded ? 'text-emerald-700 hover:text-emerald-800' : 'text-muted-foreground'}`}
        onClick={showUpdates}
      >
        v{__APP_VERSION__}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          aria-describedby={undefined}
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
                {checking && (
                  <p
                    role='status'
                    className='flex items-center gap-2 text-sm text-muted-foreground'
                  >
                    <LoaderCircle className='size-4 animate-spin' />
                    正在检查更新…
                  </p>
                )}
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
                      <Markdown skipHtml>{state.releaseNotes}</Markdown>
                    </div>
                  </section>
                )}
                {downloading && (
                  <div className='space-y-3'>
                    <div className='flex justify-between text-sm'>
                      <span>正在下载更新</span>
                      <span className='tabular-nums'>{percent}%</span>
                    </div>
                    <Progress
                      value={state.percent ?? 0}
                      aria-label='更新下载进度'
                    />
                  </div>
                )}
                {downloaded && (
                  <p
                    role='status'
                    className='flex items-center gap-2 text-sm text-emerald-700'
                  >
                    <Check className='size-4' />
                    更新已下载
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
              {available || downloaded ? (
                <>
                  {available && (
                    <Button
                      variant='outline'
                      disabled={Boolean(busy)}
                      onClick={() => run('check')}
                    >
                      <RefreshCw />
                      重新检查
                    </Button>
                  )}
                  <Button
                    disabled={!state.canInstall || Boolean(busy)}
                    onClick={() => run(downloaded ? 'install' : 'download')}
                  >
                    {busy === 'install' ? (
                      <LoaderCircle className='animate-spin' />
                    ) : downloaded ? (
                      <RotateCw />
                    ) : (
                      <Download />
                    )}
                    {!state.canInstall
                      ? '请使用安装版升级'
                      : busy === 'install'
                        ? '正在重启'
                        : downloaded
                          ? '重启安装'
                          : '下载更新'}
                  </Button>
                </>
              ) : state.status === 'error' ? (
                <Button
                  disabled={Boolean(busy)}
                  onClick={() => run(state.canInstall ? lastAction : 'check')}
                >
                  <RefreshCw />
                  重试
                </Button>
              ) : (
                <Button
                  disabled={checking || downloading || Boolean(busy)}
                  onClick={() => run('check')}
                >
                  {checking || downloading ? (
                    <LoaderCircle className='animate-spin' />
                  ) : (
                    <RefreshCw />
                  )}
                  {downloading
                    ? '正在下载'
                    : checking
                      ? '正在检查'
                      : '检查更新'}
                </Button>
              )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
