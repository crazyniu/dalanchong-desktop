/**
 * AI module map
 * Purpose: gate the React application on native licensing and display activation status.
 * Entry: LicenseGate wraps the router; LicenseStatus renders a single-line expiry
 * entry without a background and opens the expiry/device dialog.
 * Flow: subscribe to native monitor results, initialize commerce only after
 * valid authorization, and replace the application with the activation form on failure.
 * LicenseStatus uses browser.tsx's openBrowserDialog to capture the page background and
 * finish hiding native views before mounting the dialog; closing restores them afterward.
 * State: useLicense is a display snapshot; code/operation state stays in the form.
 * The form reads the saved native code locally before enabling editing. Matching
 * normalized input re-verifies that saved code; new input or a device_unbound result
 * uses explicit activation. Failed verification never invokes activation. Codes never enter
 * localStorage, diagnostic copies, shared license snapshots or logs.
 * Activation failures keep their message and native diagnostic together; copying
 * exports only the native diagnostic fields, never activation codes or device identity.
 * The initial monitor result owns the centered authorization loading state.
 * Invariants: Rust/server checks remain authoritative. The UI submits only an activation
 * code, never a device ID or expiry. Device codes are copyable display values; blank
 * hardware identity disables activation. Loading indicators stay centered.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { ChevronRight, Copy, LoaderCircle } from 'lucide-react'
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
import { LoadingState } from '@/components/ui/loading-state'
import { openBrowserDialog } from './browser'
import { desktop, type LicenseDiagnostic, type LicenseState } from './desktop'
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

function diagnosticText(diagnostic: LicenseDiagnostic) {
  const fields: [string, string | number | null | undefined][] = [
    ['时间', diagnostic.time],
    ['操作', diagnostic.action],
    ['接口', diagnostic.endpoint],
    ['失败阶段', diagnostic.stage],
    ['错误详情', diagnostic.detail],
    ['HTTP 状态', diagnostic.httpStatus],
    ['请求 ID', diagnostic.requestId],
    ['Cloudflare Ray ID', diagnostic.cfRay],
    ['响应类型', diagnostic.contentType],
    ['软件版本', diagnostic.appVersion],
    ['操作系统', diagnostic.os],
  ]
  return fields
    .filter(([, value]) => value != null)
    .map(([label, value]) => `${label}：${value}`)
    .join('\n')
}

function DeviceCode({
  value,
  inline = false,
}: {
  value: string
  inline?: boolean
}) {
  return (
    <div
      className={
        inline ? 'flex items-center justify-between gap-4' : 'space-y-2'
      }
    >
      <span
        className={
          inline
            ? 'shrink-0 text-sm text-muted-foreground'
            : 'text-sm font-medium'
        }
      >
        设备码
      </span>
      <div
        className={
          inline
            ? 'flex min-w-0 items-center gap-2'
            : 'flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2'
        }
      >
        <code
          className='min-w-0 flex-1 break-all text-sm leading-6 select-all'
        >
          {value}
        </code>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-8 shrink-0'
          aria-label='复制设备码'
          title='复制设备码'
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
  const [savedCode, setSavedCode] = useState('')
  const [loadingSavedCode, setLoadingSavedCode] = useState(true)
  const [operation, setOperation] = useState<'activate' | 'verify' | null>(null)
  const [failure, setFailure] = useState<{
    message: string
    diagnostic?: LicenseDiagnostic | null
  } | null>(null)
  const normalizeCode = (value: string) => value.toUpperCase().replace(/[\s-]/g, '')
  const normalizedCode = normalizeCode(code)
  const verifying = state?.reason !== 'device_unbound' && Boolean(savedCode)
    && normalizedCode === normalizeCode(savedCode)
  const busy = operation !== null
  useEffect(() => {
    let mounted = true
    desktop!.getSavedLicenseCode()
      .then((saved) => {
        if (!mounted) return
        setSavedCode(saved)
        setCode(saved)
      })
      .catch((error) => {
        if (mounted) toast.error(errorText(error))
      })
      .finally(() => { if (mounted) setLoadingSavedCode(false) })
    return () => { mounted = false }
  }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setOperation(verifying ? 'verify' : 'activate')
    setFailure(null)
    try {
      const result = verifying
        ? await desktop!.verifyLicense()
        : await desktop!.activateLicense(code)
      if (!result.valid) {
        setFailure({
          message: result.message || (verifying ? '验证失败，请重试' : '激活失败，请重试'),
          diagnostic: result.diagnostic,
        })
      }
    } catch (e) {
      setFailure({ message: errorText(e) })
    } finally {
      setOperation(null)
    }
  }
  const error = busy || loadingSavedCode || state?.valid
    ? null
    : failure ?? (state?.reason !== 'not_activated' ? state : null)
  const message = error?.message
  const diagnostic = error?.diagnostic
  return (
    <form onSubmit={submit} className='space-y-5' aria-busy={busy || loadingSavedCode}>
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
          disabled={busy || loadingSavedCode}
          aria-invalid={Boolean(message)}
          aria-describedby={message ? 'activation-error' : undefined}
          className='h-11 font-mono'
        />
      </div>
      {message && (
        <div className='space-y-2'>
          <p
            id='activation-error'
            role='alert'
            className='text-sm text-destructive'
          >
            {message}
          </p>
          {diagnostic && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(diagnosticText(diagnostic))
                  toast.success('错误详情已复制')
                } catch {
                  toast.error('复制错误详情失败')
                }
              }}
            >
              <Copy className='size-4' />
              复制错误详情
            </Button>
          )}
        </div>
      )}
      <Button
        type='submit'
        disabled={busy || loadingSavedCode || !normalizedCode || !state?.deviceId}
        className='h-11 w-full'
      >
        {(busy || loadingSavedCode) && <LoaderCircle className='size-4 animate-spin' />}
        {loadingSavedCode ? '正在读取…' : busy ? operation === 'verify' ? '验证中…' : '激活中…' : verifying ? '重新验证' : '激活'}
      </Button>
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
  if (checking || !state || !state.checked || state.valid) {
    return (
      <main className='flex min-h-svh items-center justify-center bg-muted/30 px-6'>
        {error ? (
          <p role='alert' className='text-center text-sm text-destructive'>
            {error}
          </p>
        ) : (
          <LoadingState
            label={state?.valid ? '正在加载数据…' : '正在验证授权…'}
          />
        )}
      </main>
    )
  }
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
        <ActivationForm />
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
  })
  const expiryLabel = expiry ? `${expiryDate} ${expiryTime}` : '永久有效'
  const remaining = expiry ? expiry.getTime() - Date.now() : null
  const expired = remaining !== null && remaining <= 0
  const expiringSoon = remaining !== null && remaining <= 7 * 86400000
  const statusLabel = expired
    ? '授权已到期'
    : expiringSoon
      ? '即将到期'
      : expiry
        ? '到期时间'
        : '授权期限'
  const colors = expired
    ? 'text-destructive hover:text-destructive'
    : expiringSoon
      ? 'text-amber-700 hover:text-amber-800'
      : 'text-muted-foreground hover:text-foreground'
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          void openBrowserDialog(() => setOpen(true))
        } else {
          setOpen(false)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant='ghost'
          size='sm'
          aria-label={`激活信息，到期时间：${expiryLabel}`}
          title={`到期时间：${expiryLabel}`}
          className={`h-9 w-full justify-between gap-1 bg-transparent px-1 text-left text-sm font-normal hover:bg-transparent has-[>svg]:px-1 dark:hover:bg-transparent ${colors}`}
        >
          <span>{statusLabel}</span>
          <span className='tabular-nums'>
            {state.expiresAt ? (
              <time dateTime={state.expiresAt}>{expiryDate}</time>
            ) : (
              '永久有效'
            )}
          </span>
          <ChevronRight className='size-3.5 shrink-0' />
        </Button>
      </DialogTrigger>
      <DialogContent
        aria-describedby={undefined}
        className='gap-0 overflow-hidden p-0 sm:max-w-[520px]'
      >
        <DialogHeader className='border-b px-6 py-5'>
          <DialogTitle>激活信息</DialogTitle>
        </DialogHeader>
        <div className='space-y-6 px-6 py-5'>
          <dl className='flex items-center justify-between gap-4 text-sm'>
            <dt className='text-muted-foreground'>到期时间</dt>
            <dd className='font-medium tabular-nums'>{expiryLabel}</dd>
          </dl>
          <DeviceCode value={state.deviceId} inline />
        </div>
      </DialogContent>
    </Dialog>
  )
}
