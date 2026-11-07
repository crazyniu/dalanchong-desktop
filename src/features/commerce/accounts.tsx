/**
 * AI module map
 * Purpose: manage platform account records and their caller-owned login entry points.
 * Entry: AccountsDialog presents the platform table; AccountActionDialog handles its
 * add/rename/remove actions and the same shortcuts from invitation account tabs.
 * Flow: add account metadata, open or relogin through the native browser, edit account.name
 * as a local remark through the persisted commerce store, inspect logs, and confirm removal.
 * Invitation workspaces supply onAdded to log into the new account's existing Tab;
 * other creation callers and manual open/login actions use a separate native window.
 * State: callers own the current action; each opened action owns its name input,
 * deletion progress, and preview login step. The commerce store owns account data.
 * AccountQuota shares observed-balance freshness and error display with the dashboard.
 * Invariants: local remarks and platform-confirmed shop identity are separate. A login
 * window opening is not login success; cookies and actual identity are owned by native
 * sessions/runtime observations. Browser preview uses the isolated demo behavior.
 */

import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Plus,
  Pencil,
  ArrowUpRight,
  LogIn,
  Trash2,
  ScrollText,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AccountQuota } from './account-quota'
import { browserError } from './browser-session'
import { desktop } from './desktop'
import { formatTime } from './format'
import { SearchInput, NameAvatar } from './shared'
import { useCommerce } from './store'
import { TaskLogsDialog } from './task-logs'
import type { Platform, Account } from './types'

export type AccountAction =
  | { type: 'add' }
  | { type: 'rename'; account: Account }
  | { type: 'remove'; account: Account }

export function AccountsDialog({
  platform,
  open,
  onOpenChange,
  onAdded,
}: {
  platform: Platform
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: (account: Account) => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[1100px]'>
        <DialogHeader className='border-b px-6 py-5 pr-12'>
          <DialogTitle>账号管理</DialogTitle>
          <DialogDescription className='sr-only'>
            添加、编辑名称、登录或删除当前平台账号
          </DialogDescription>
        </DialogHeader>
        <AccountsManager key={platform} platform={platform} onAdded={onAdded} />
      </DialogContent>
    </Dialog>
  )
}

function AccountsManager({
  platform,
  onAdded,
}: {
  platform: Platform
  onAdded?: (account: Account) => Promise<void>
}) {
  const store = useCommerce(useShallow((s) => ({
    accounts: s.accounts,
    selected: s.selected,
  })))
  const runningAccountIds = useCommerce(useShallow((s) => s.accounts
    .filter((account) => account.platform === platform &&
      (s.tasks[`${account.id}:collect`]?.status === 'running' ||
        s.tasks[`${account.id}:invite`]?.status === 'running'))
    .map((account) => account.id)
  ))
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<AccountAction | null>(
    store.accounts.some((account) => account.platform === platform)
      ? null
      : { type: 'add' }
  )
  const [logsOpen, setLogsOpen] = useState(false)
  const currentAccount =
    store.accounts.find(
      (a) => a.platform === platform && a.id === store.selected[platform]
    ) || store.accounts.find((a) => a.platform === platform)
  const [loginId, setLoginId] = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const filtered = store.accounts.filter(
    (a) =>
      a.platform === platform &&
      (a.name + (a.shopName ?? '') + a.shopId).includes(query)
  )
  const loggingIn = store.accounts.find((a) => a.id === loginId)
  async function openAccount(a: Account, closeOnLogin = a.status !== 'online') {
    if (!desktop) {
      setLoginId(a.id)
      return
    }
    setOpeningId(a.id)
    try {
      await desktop.openAccountLogin(
        { id: a.id, platform: a.platform, name: a.name },
        closeOnLogin
      )
    } catch (error) {
      toast.error(browserError(error))
    } finally {
      setOpeningId(null)
    }
  }
  return (
    <div className='min-h-0 space-y-5 overflow-y-auto px-6 py-5'>
      <div className='page-toolbar flex-wrap'>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder='搜索店铺或账号'
          className='mr-auto w-60'
        />
        <Button
          variant='outline'
          disabled={!currentAccount}
          onClick={() => setLogsOpen(true)}
        >
          <ScrollText />
          错误日志
        </Button>
        <Button onClick={() => setAction({ type: 'add' })}>
          <Plus />
          添加账号
        </Button>
      </div>
      <div className='overflow-hidden rounded-xl border bg-white'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='pl-6'>店铺账号</TableHead>
              <TableHead>登录状态</TableHead>
              <TableHead>登录保存时间</TableHead>
              <TableHead>剩余额度</TableHead>
              <TableHead className='w-56' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a, i) => (
              <TableRow key={a.id} className='h-24'>
                <TableCell className='pl-6'>
                  <div className='flex items-center gap-3'>
                    <NameAvatar name={a.name} index={i} />
                    <div className='space-y-1.5'>
                      <div className='font-medium'>{a.name}</div>
                      <div className='text-sm text-muted-foreground'>
                        {a.shopName && a.shopName !== a.name
                          ? `${a.shopName} · ${a.shopId}`
                          : a.shopId}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant='outline'
                    className={`gap-1.5 border-0 font-normal ${a.status === 'online' ? 'bg-emerald-50 text-emerald-700' : a.status === 'expired' ? 'bg-amber-50 text-amber-800' : 'bg-muted text-muted-foreground'}`}
                  >
                    <span className='size-1.5 rounded-full bg-current' />
                    {a.status === 'online'
                      ? '已登录'
                      : a.status === 'expired'
                        ? '登录已失效'
                        : '未登录'}
                  </Badge>
                </TableCell>
                <TableCell className='text-muted-foreground tabular-nums'>
                  {a.savedAt ? formatTime(a.savedAt) : '—'}
                </TableCell>
                <TableCell>
                  <AccountQuota account={a} />
                </TableCell>
                <TableCell>
                  <div className='flex items-center gap-1'>
                    <Button
                      size='sm'
                      variant={a.status === 'online' ? 'outline' : 'secondary'}
                      disabled={openingId === a.id}
                      onClick={() => openAccount(a)}
                    >
                      {a.status === 'online' ? '打开' : '登录'}
                      {a.status === 'online' ? <ArrowUpRight /> : <LogIn />}
                    </Button>
                    {a.status === 'online' && (
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`重新登录${a.name}`}
                        title='重新登录'
                        disabled={openingId === a.id}
                        onClick={() => openAccount(a, true)}
                      >
                        <LogIn />
                      </Button>
                    )}
                    <Button
                      variant='ghost'
                      size='icon'
                      aria-label={`编辑${a.name}的名称`}
                      title='编辑名称'
                      onClick={() => setAction({ type: 'rename', account: a })}
                    >
                      <Pencil />
                    </Button>
                    <Button
                      variant='ghost'
                      size='icon'
                      className='text-destructive hover:text-destructive'
                      aria-label={`删除${a.name}`}
                      title='删除账号'
                      onClick={() => setAction({ type: 'remove', account: a })}
                      disabled={runningAccountIds.includes(a.id)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!filtered.length && (
          <div className='grid place-items-center gap-3 py-28 text-muted-foreground'>
            <Store className='size-9' />
            <p>暂无符合条件的账号</p>
          </div>
        )}
      </div>
      <AccountActionDialog
        platform={platform}
        action={action}
        onClose={() => setAction(null)}
        onAdded={onAdded}
      />
      <DemoLoginDialog
        account={loggingIn ?? null}
        onClose={() => setLoginId(null)}
      />
      {logsOpen && currentAccount && (
        <TaskLogsDialog
          key={currentAccount.id}
          open
          onOpenChange={setLogsOpen}
          platform={platform}
          accountId={currentAccount.id}
        />
      )}
    </div>
  )
}

export function AccountActionDialog({
  platform,
  action,
  onClose,
  onAdded,
}: {
  platform: Platform
  action: AccountAction | null
  onClose: () => void
  onAdded?: (account: Account) => Promise<void>
}) {
  return (
    action && (
      <AccountActionContent
        key={action.type === 'add' ? 'add' : `${action.type}:${action.account.id}`}
        platform={platform}
        action={action}
        onClose={onClose}
        onAdded={onAdded}
      />
    )
  )
}

function AccountActionContent({
  platform,
  action,
  onClose,
  onAdded,
}: {
  platform: Platform
  action: AccountAction
  onClose: () => void
  onAdded?: (account: Account) => Promise<void>
}) {
  const store = useCommerce(useShallow((s) => ({
    addAccount: s.addAccount,
    removeAccount: s.removeAccount,
    renameAccount: s.renameAccount,
    selectAccount: s.selectAccount,
  })))
  const running = useCommerce((s) => action.type === 'remove' &&
    (s.tasks[`${action.account.id}:collect`]?.status === 'running' ||
      s.tasks[`${action.account.id}:invite`]?.status === 'running')
  )
  const [name, setName] = useState(
    action.type === 'rename' ? action.account.name : ''
  )
  const [removing, setRemoving] = useState(false)
  const [loggingIn, setLoggingIn] = useState<Account | null>(null)

  if (loggingIn) {
    return <DemoLoginDialog account={loggingIn} onClose={onClose} />
  }

  if (action.type === 'remove') {
    return (
      <AlertDialog open onOpenChange={(open) => !open && onClose()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className='break-words'>
              删除账号「{action.account.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              该账号的登录数据将清除，历史邀约记录保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>取消</AlertDialogCancel>
            <Button
              variant='destructive'
              disabled={removing || running}
              onClick={async () => {
                setRemoving(true)
                try {
                  await store.removeAccount(action.account.id)
                  onClose()
                  toast.success('账号已删除')
                } catch (error) {
                  toast.error(browserError(error))
                } finally {
                  setRemoving(false)
                }
              }}
            >
              {removing ? '正在删除' : '删除账号'}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader className='sm:text-center'>
          <DialogTitle>
            {action.type === 'add' ? '添加账号' : '编辑账号名称'}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            if (action.type === 'rename') {
              store.renameAccount(action.account.id, name.trim())
              onClose()
              return
            }
            const id = store.addAccount(platform, name.trim())
            store.selectAccount(platform, id)
            const account = useCommerce
              .getState()
              .accounts.find((a) => a.id === id)!
            if (!desktop) {
              setLoggingIn(account)
              return
            }
            onClose()
            try {
              if (onAdded) await onAdded(account)
              else
                await desktop.openAccountLogin(
                  { id, platform, name: account.name },
                  true
                )
            } catch (error) {
              toast.error(browserError(error))
            }
          }}
          className='space-y-5'
        >
          <div className='space-y-2'>
            <Label htmlFor='account-name'>账号名称</Label>
            <Input
              id='account-name'
              placeholder='输入账号名称'
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              取消
            </Button>
            <Button type='submit' disabled={!name.trim()}>
              {action.type === 'add' ? '添加并登录' : '保存'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DemoLoginDialog({
  account,
  onClose,
}: {
  account: Account | null
  onClose: () => void
}) {
  const login = useCommerce((store) => store.login)
  return (
    <Dialog open={Boolean(account)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-[400px]'>
        <DialogHeader className='sm:text-center'>
          <DialogTitle>账号登录</DialogTitle>
          <DialogDescription className='sr-only'>
            演示账号登录流程
          </DialogDescription>
        </DialogHeader>
        {account && (
          <div className='flex flex-col items-center gap-6 py-6'>
            <span className='flex size-16 items-center justify-center rounded-2xl bg-muted'>
              <Store className='size-7' />
            </span>
            <div className='flex flex-col items-center gap-3'>
              <h3 className='text-lg font-semibold'>{account.name}</h3>
            </div>
            <Badge variant='outline'>演示登录</Badge>
            <Button
              className='w-full'
              onClick={() => {
                login(account.id)
                onClose()
                toast.success('演示登录成功，账号状态已更新')
              }}
            >
              模拟登录成功
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
