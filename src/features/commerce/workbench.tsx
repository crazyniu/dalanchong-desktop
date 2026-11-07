/**
 * AI module map
 * Purpose: manage named browser accounts and launch independent Google Chrome profiles.
 * Entry: WorkbenchPage is /workbench; native chrome_* commands own metadata and profiles.
 * Flow: load account records, open a browser or existing window,
 * and save/edit/remove records through main-only IPC. Chrome owns tabs and bookmarks.
 * State: cards show account names and last-opened times from workbench.json;
 * dialogs and launch progress are UI-only.
 * With no browsers, the centered empty state owns creation; populated grids use the toolbar.
 * The controlled form edits only the account name. Native chrome.rs owns validation,
 * metadata persistence and browser launch; renaming preserves the profile and open window.
 * A missing Chrome installation exposes the official download page through an error-toast action.
 * The auto-fill grid retains card width for small lists and adapts to the content area.
 * Invariants: no invitation accounts/tasks are changed. Opening is not proof of login;
 * show last-opened time only. Preview cannot launch a real browser or simulate success.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import {
  ArrowUpRight,
  LoaderCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Store,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LoadingState } from '@/components/ui/loading-state'
import { browserError } from './browser-session'
import { desktop } from './desktop'
import { formatTime } from './format'

type ChromeAccount = {
  id: string
  number: number
  name: string
  lastOpenedAt: string | null
}
type AccountForm = Pick<ChromeAccount, 'name'> & { id?: string }

export function WorkbenchPage() {
  const [accounts, setAccounts] = useState<ChromeAccount[]>([])
  const [loading, setLoading] = useState(Boolean(desktop))
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [opening, setOpening] = useState('')
  const [form, setForm] = useState<AccountForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<ChromeAccount | null>(null)
  const [deleting, setDeleting] = useState(false)
  const busy = Boolean(opening) || saving || deleting

  useEffect(() => {
    if (!desktop) return
    let active = true
    void invoke<ChromeAccount[]>('chrome_accounts')
      .then((records) => {
        if (active) { setAccounts(records); setError('') }
      })
      .catch((reason) => { if (active) setError(browserError(reason)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [reload])

  function updateAccount(account: ChromeAccount) {
    setAccounts((current) => current.some((entry) => entry.id === account.id)
      ? current.map((entry) => entry.id === account.id ? account : entry)
      : [...current, account])
  }
  async function openAccount(account: ChromeAccount) {
    setOpening(account.id)
    try {
      updateAccount(await invoke<ChromeAccount>('chrome_open', { id: account.id }))
    } catch (reason) {
      const message = browserError(reason)
      if (message === '未找到 Google Chrome，请先安装正式版 Chrome') {
        toast.error(message, {
          action: {
            label: '下载 Chrome',
            onClick: () => {
              void invoke('browser_open_external', { url: 'https://www.google.cn/chrome/' })
                .catch((error) => toast.error(browserError(error)))
            },
          },
        })
      } else {
        toast.error(message)
      }
    } finally {
      setOpening('')
    }
  }
  function addAccount() {
    setForm({ name: '' })
  }
  return (
    <main className='relative flex h-svh min-h-0 min-w-0 flex-col bg-muted/30'>
      {accounts.length > 0 && (
        <div className='workspace-toolbar shrink-0'>
          <div className='page-toolbar flex-wrap'>
            <h1 className='text-2xl font-semibold'>多店铺</h1>
            <Button className='ml-auto' disabled={!desktop || loading || busy} onClick={addAccount}><Plus />新建店铺</Button>
          </div>
        </div>
      )}
      <div className={`min-h-0 flex-1 overflow-y-auto ${accounts.length ? 'px-5 pt-3 pb-6' : ''}`}>
        {!desktop ? (
          <div className='grid h-full min-h-64 place-content-center text-muted-foreground'>请在桌面程序中使用多店铺</div>
        ) : loading ? (
          <LoadingState label='正在加载店铺…' className='h-full' />
        ) : error ? (
          <div className='grid h-full min-h-64 place-content-center justify-items-center gap-4'>
            <p className='text-sm text-destructive'>{error}</p>
            <Button variant='outline' onClick={() => { setLoading(true); setReload((value) => value + 1) }}>重新加载</Button>
          </div>
        ) : !accounts.length ? (
          <div className='grid h-full place-content-center justify-items-center gap-4'>
            <Store className='size-9 text-muted-foreground' />
            <p>暂无店铺</p>
            <Button disabled={busy} onClick={addAccount}>
              <Plus />
              新建店铺
            </Button>
          </div>
        ) : (
          <ul className='grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4' aria-label='店铺列表'>
            {accounts.map((account) => (
              <li key={account.id} className='min-w-0'>
                <Card className='h-full min-w-0 gap-5 py-5 shadow-none'>
                  <CardHeader className='flex min-h-6 flex-row items-start justify-between gap-3 px-5'>
                    <CardTitle className='min-w-0 flex-1 text-base leading-6'>
                      <h2 className='flex min-w-0 items-start gap-2.5'>
                        <Store className='mt-0.5 size-5 shrink-0 text-muted-foreground' aria-hidden='true' />
                        <button
                          type='button'
                          className='min-w-0 flex-1 rounded-sm text-left no-underline outline-none hover:no-underline focus:no-underline focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
                          disabled={busy}
                          onClick={() => void openAccount(account)}
                          title={account.name}
                          aria-label={`打开店铺「${account.name}」`}
                        >
                          <span className='line-clamp-2 min-w-0 wrap-anywhere'>{account.name}</span>
                        </button>
                      </h2>
                    </CardTitle>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant='ghost' size='icon' className='-mt-1 -mr-2' disabled={busy} aria-label={`店铺「${account.name}」的操作`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem onClick={() => setForm({ id: account.id, name: account.name })}>
                          <Pencil />编辑名称
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant='destructive' onClick={() => setRemoving(account)}><Trash2 />删除店铺</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </CardHeader>
                  <CardFooter className='mt-auto flex-wrap justify-between gap-3 px-5'>
                    <dl className='space-y-1 text-sm'>
                      <dt className='text-muted-foreground'>最近打开</dt>
                      <dd className='tabular-nums'>
                        {account.lastOpenedAt ? <time dateTime={account.lastOpenedAt}>{formatTime(account.lastOpenedAt)}</time> : '尚未打开'}
                      </dd>
                    </dl>
                    <Button variant='outline' disabled={busy} onClick={() => void openAccount(account)} aria-label={`打开店铺「${account.name}」`}>
                      {opening === account.id ? <LoaderCircle className='animate-spin' /> : <ArrowUpRight />}
                      {opening === account.id ? '正在打开' : '打开'}
                    </Button>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog open={Boolean(form)} onOpenChange={(open) => { if (!open && !saving) setForm(null) }}>
        <DialogContent showCloseButton={!saving} className='flex max-h-[85svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md'>
          <DialogHeader className='shrink-0 px-6 pt-6 pb-5 sm:text-center'>
            <DialogTitle>{form?.id ? '编辑店铺' : '新建店铺'}</DialogTitle>
            <DialogDescription className='sr-only'>设置店铺名称</DialogDescription>
          </DialogHeader>
          {form && (
            <form className='flex min-h-0 flex-col' onSubmit={async (event) => {
              event.preventDefault()
              setSaving(true)
              const adding = !form.id
              try {
                const account = await invoke<ChromeAccount>('chrome_save_account', { input: form })
                updateAccount(account)
                setForm(null)
                if (adding) await openAccount(account)
              } catch (reason) {
                toast.error(browserError(reason))
              } finally {
                setSaving(false)
              }
            }}>
              <div className='min-h-0 space-y-5 overflow-y-auto px-6 pb-6'>
                <div className='space-y-2'>
                  <Label htmlFor='workbench-name'>店铺名称</Label>
                  <Input id='workbench-name' value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder='输入店铺名称' required autoFocus disabled={saving} />
                </div>
              </div>
              <DialogFooter className='shrink-0 border-t px-6 py-4'>
                <Button type='button' variant='outline' onClick={() => setForm(null)} disabled={saving}>取消</Button>
                <Button type='submit' disabled={saving || !form.name.trim()}>
                  {saving && <LoaderCircle className='animate-spin' />}{form.id ? '保存' : '创建并打开'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open && !deleting) setRemoving(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除店铺「{removing?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>该店铺的浏览器窗口将关闭，本地配置、登录信息和收藏将一并删除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button variant='destructive' disabled={deleting} onClick={async () => {
              if (!removing) return
              setDeleting(true)
              try {
                await invoke('chrome_remove_account', { id: removing.id })
                setAccounts((current) => current.filter((account) => account.id !== removing.id))
                setRemoving(null)
              } catch (reason) {
                toast.error(browserError(reason))
              } finally {
                setDeleting(false)
              }
            }}>{deleting ? '正在删除' : '删除店铺'}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
