import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Copy, KeyRound, LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { desktop, type LicenseState } from './desktop'
import { useCommerce } from './store'

const useLicense = create<{ state: LicenseState | null }>(() => ({
  state: null,
}))

function errorText(error: unknown) {
  return (error as Error).message.replace(
    /^Error invoking remote method '[^']+': Error: /,
    ''
  )
}

function DeviceCode({ value }: { value: string }) {
  return (
    <div className='space-y-2'>
      <span className='text-sm font-medium'>设备码</span>
      <div className='flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2'>
        <code className='min-w-0 flex-1 text-sm leading-6 break-all select-all'>
          {value}
        </code>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          aria-label='复制设备码'
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value)
              toast.success('设备码已复制')
            } catch {
              toast.error('复制失败，请选中设备码复制')
            }
          }}
        >
          <Copy className='size-4' />
        </Button>
      </div>
    </div>
  )
}

function ActivationForm() {
  const state = useLicense((s) => s.state)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await desktop!.activateLicense(code)
      if (!result.valid) setError(result.message || '激活失败，请重试')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  async function retry() {
    setBusy(true)
    setError('')
    try {
      await desktop!.verifyLicense()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const message =
    error ||
    (!state?.valid && state?.reason !== 'not_activated' ? state?.message : '')
  return (
    <form onSubmit={submit} className='space-y-5' aria-busy={busy}>
      <div className='space-y-2'>
        <Label htmlFor='activation-code'>激活码</Label>
        <Input
          id='activation-code'
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder='输入激活码'
          autoComplete='off'
          spellCheck={false}
          maxLength={100}
          disabled={busy}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? 'activation-error' : undefined}
          className='h-11 font-mono'
        />
      </div>
      {message && (
        <p
          id='activation-error'
          role='alert'
          className='text-sm text-destructive'
        >
          {message}
        </p>
      )}
      <Button
        type='submit'
        disabled={busy || !code.trim()}
        className='h-11 w-full'
      >
        {busy && <LoaderCircle className='size-4 animate-spin' />}
        激活
      </Button>
      {!state?.valid && state?.hasCode && (
        <Button
          type='button'
          variant='outline'
          disabled={busy}
          onClick={retry}
          className='h-11 w-full'
        >
          重新验证
        </Button>
      )}
    </form>
  )
}

export function LicenseGate({ children }: { children: ReactNode }) {
  const state = useLicense((s) => s.state)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(Boolean(desktop))
  useEffect(() => {
    if (!desktop) return
    const unsubscribe = desktop.onEvent((event) => {
      if (event.type === 'license') useLicense.setState({ state: event.state })
    })
    desktop
      .getLicenseState()
      .then((current) => {
        useLicense.setState({ state: current })
        return desktop!.verifyLicense()
      })
      .catch((e) => setError(errorText(e)))
      .finally(() => setChecking(false))
    return unsubscribe
  }, [])
  useEffect(() => {
    if (!desktop || !state?.valid) return
    let mounted = true
    desktop
      .initialize()
      .then((data) => {
        if (mounted) {
          useCommerce.setState(data)
          setReady(true)
        }
      })
      .catch((e) => {
        if (mounted) setError(errorText(e))
      })
    return () => {
      mounted = false
    }
  }, [state?.valid])
  if (!desktop || (state?.valid && ready)) return children
  return (
    <main className='flex min-h-svh items-center justify-center bg-muted/30 px-6'>
      <section className='w-full max-w-md space-y-8 rounded-xl border bg-background p-8'>
        <div className='flex flex-col items-center gap-3'>
          <img src='./brand.png' alt='' className='size-24 object-contain' />
          <h1 className='text-center text-2xl font-semibold'>大懒虫</h1>
        </div>
        {state?.deviceId && <DeviceCode value={state.deviceId} />}
        {error && (
          <p role='alert' className='text-sm text-destructive'>
            {error}
          </p>
        )}
        {checking || !state || state.valid ? (
          <p
            role='status'
            className='flex items-center gap-2 text-sm text-muted-foreground'
          >
            <LoaderCircle className='size-4 animate-spin' />
            正在验证授权…
          </p>
        ) : (
          <ActivationForm />
        )}
      </section>
    </main>
  )
}

export function LicenseStatus() {
  const state = useLicense((s) => s.state)
  const [open, setOpen] = useState(false)
  if (!desktop || !state?.valid) return null
  const expiry = state.expiresAt ? new Date(state.expiresAt) : null
  const expiryDate = expiry?.toLocaleDateString('zh-CN', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const expiryTime = expiry?.toLocaleTimeString('zh-CN', {
    timeZone: 'Asia/Taipei',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const expiryLabel = expiry ? `${expiryDate} ${expiryTime}` : '永久有效'
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          aria-label='授权管理'
          title={`到期时间：${expiryLabel}`}
          className='h-auto w-full justify-between gap-2 px-2 py-2.5'
        >
          <span className='flex shrink-0 items-center gap-1.5 text-emerald-700'>
            <KeyRound className='size-4' />
            <span>已激活</span>
          </span>
          {state.expiresAt ? (
            <time
              dateTime={state.expiresAt}
              className='flex shrink-0 flex-col items-end text-sm leading-5 font-normal text-muted-foreground tabular-nums'
            >
              <span>{expiryDate}</span>
              <span>{expiryTime}</span>
            </time>
          ) : (
            <span className='text-sm font-normal text-muted-foreground'>
              永久有效
            </span>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby={undefined} className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>授权管理</DialogTitle>
        </DialogHeader>
        <div className='space-y-5 py-2'>
          <div className='space-y-2'>
            <span className='text-sm font-medium'>到期时间</span>
            <p className='text-base tabular-nums'>{expiryLabel}</p>
          </div>
          <DeviceCode value={state.deviceId} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
