import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { LogIn, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  BrowserHost,
  FloatingToolbar,
  useNativeInviteProgress,
} from './browser'
import { browserError, reloadPlatform, useGuestState } from './browser-session'
import { CollectionList } from './collection-list'
import { CollectionLog } from './collection-log'
import { type ToolbarAction, type ToolbarState } from './collection-toolbar'
import { desktop } from './desktop'
import { InviteCompose } from './invite-compose'
import {
  InviteProgress,
  useInviteProgressVisibility,
  type InviteProgressAction,
  type InviteProgressState,
} from './invite-progress'
import { PlatformPreview } from './platform-preview'
import { RecordsDialog } from './records'
import { collectDemo, defaultFilters, stopDemo, useCommerce } from './store'
import { TaskLogsDialog } from './task-logs'
import type { Platform } from './types'

export function InvitePage({ platform }: { platform: Platform }) {
  const store = useCommerce()
  const navigate = useNavigate()
  const available = store.accounts.filter((a) => a.platform === platform)
  const browserAccount =
    available.find((a) => a.id === store.selected[platform]) || available[0]
  const pageState = useGuestState((s) => s.sessions[browserAccount?.id])
  const pageReady = !desktop || pageState?.status === 'ready'
  const [listOpen, setListOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [inviteTalentIds, setInviteTalentIds] = useState<string[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
  const {
    dismissed: dismissedInvites,
    dismiss,
    show,
  } = useInviteProgressVisibility()
  const [inviteAccountId, setInviteAccountId] = useState('')
  const [pendingInvite, setPendingInvite] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [returning, setReturning] = useState(false)
  const [starting, setStarting] = useState(false)
  const talents = store.talents.filter((t) => t.platform === platform)
  const sendAccount = available.find((a) => a.id === inviteAccountId)
  const shownAccount = composeOpen && sendAccount ? sendAccount : browserAccount
  const collectionTask = browserAccount
    ? store.tasks[browserAccount.id]
    : undefined
  const collecting =
    collectionTask?.kind === 'collect' && collectionTask.status === 'running'
  const inviting =
    collectionTask?.kind === 'invite' && collectionTask.status === 'running'
  const pageBusy =
    shownAccount && store.tasks[shownAccount.id]?.status === 'running'
  const inviteTasks = available
    .map((a) => ({ account: a, task: store.tasks[a.id] }))
    .filter(({ task }) => task && task.kind !== 'collect')
  const visibleInvites = inviteTasks.filter(
    ({ task }) =>
      !dismissedInvites.includes(`${task.accountId}:${task.startedAt}`)
  )
  const inviteProgress: InviteProgressState | null = visibleInvites.length
    ? {
        platform,
        tasks: visibleInvites.map(({ account, task }) => ({
          name: account.name,
          task,
        })),
      }
    : null
  function progressAction(action: InviteProgressAction) {
    if (action.type === 'stop') void stop(action.accountId)
    else
      dismiss(
        visibleInvites.map(({ task }) => `${task.accountId}:${task.startedAt}`)
      )
  }
  function showProgress() {
    show(inviteTasks.map(({ task }) => `${task.accountId}:${task.startedAt}`))
  }
  useNativeInviteProgress(inviteProgress, progressAction)
  async function collect() {
    if (!pageReady || (desktop && !store.captured[browserAccount.id])) return
    setStarting(true)
    try {
      if (desktop) await desktop.collect(browserAccount.id)
      else
        collectDemo(browserAccount, {
          ...(store.filters[browserAccount.id] || defaultFilters),
        })
    } catch (e) {
      toast.error(browserError(e))
    } finally {
      setStarting(false)
    }
  }
  async function stop(id: string) {
    try {
      if (desktop) await desktop.stop(id)
      else stopDemo(id)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  function openInvite(ids: string[]) {
    setInviteTalentIds(ids)
    setInviteAccountId(sendAccount?.id || browserAccount?.id || '')
    setComposeOpen(true)
  }
  function loginForInvite(id: string) {
    store.selectAccount(platform, id)
    setComposeOpen(false)
    setListOpen(false)
    setPendingInvite(true)
  }
  async function returnToInvite() {
    setReturning(true)
    try {
      store.selectAccount(platform, inviteAccountId)
      if (desktop && !(await reloadPlatform(inviteAccountId))) return
      setListOpen(true)
      setComposeOpen(true)
    } finally {
      setReturning(false)
    }
  }
  const toolbar: ToolbarState = {
    accountId: browserAccount?.id || '',
    accounts: available.map(({ id, name, status }) => ({ id, name, status })),
    view: 'collect',
    count: talents.length,
    progress: collecting
      ? `已采集 ${collectionTask.collected}`
      : collectionTask?.kind === 'collect'
        ? collectionTask.current
        : '',
    collecting,
    inviting,
    hasInvites: inviteTasks.length > 0,
    pendingInvite,
    returning,
    disabled:
      !collecting &&
      !inviting &&
      (!pageReady ||
        Boolean(desktop && !store.captured[browserAccount?.id]) ||
        browserAccount?.status !== 'online' ||
        starting ||
        collectionTask?.status === 'running'),
    label: collecting
      ? '停止采集'
      : inviting
        ? '停止邀约'
        : !pageReady
          ? pageState?.status === 'error'
            ? '网页未就绪'
            : '正在加载网页'
          : starting
            ? '正在启动'
            : desktop && !store.captured[browserAccount?.id]
              ? '等待网页筛选'
              : '开始采集',
  }
  function toolbarAction(action: ToolbarAction) {
    switch (action.type) {
      case 'view':
        if (action.view === 'list') setListOpen(true)
        break
      case 'account':
        store.selectAccount(platform, action.id)
        break
      case 'manage':
        void navigate({ to: '/accounts' })
        break
      case 'reload':
        if (desktop) void reloadPlatform(browserAccount.id)
        else toast.success('网页预览已刷新')
        break
      case 'collect':
        void collect()
        break
      case 'stop':
        void stop(browserAccount.id)
        break
      case 'return':
        void returnToInvite()
        break
      case 'logs':
        setLogsOpen(true)
        break
      case 'records':
        setRecordsOpen(true)
        break
      case 'progress':
        showProgress()
        break
    }
  }
  return (
    <main className='relative flex h-svh min-h-0 flex-none flex-col'>
      <FloatingToolbar state={toolbar} onAction={toolbarAction} />
      <div
        className='relative flex min-h-0 flex-1 flex-col'
        data-testid='platform-workspace'
      >
        <div className='flex min-h-0 flex-1 flex-col' inert={Boolean(pageBusy)}>
          {shownAccount ? (
            desktop ? (
              <BrowserHost account={shownAccount} />
            ) : (
              <PlatformPreview key={shownAccount.id} account={shownAccount} />
            )
          ) : (
            <div className='grid flex-1 place-content-center justify-items-center gap-4'>
              <UsersRound className='size-9 text-muted-foreground' />
              <p>添加账号后打开平台网页</p>
              <Button asChild>
                <Link to='/accounts'>
                  <LogIn />
                  添加账号
                </Link>
              </Button>
            </div>
          )}
        </div>
        {!desktop && pageBusy && (
          <div className='absolute inset-0 z-20 grid cursor-wait place-items-center bg-slate-950/15'>
            <span className='rounded-xl bg-background px-4 py-3 text-sm shadow-lg'>
              任务运行中
            </span>
          </div>
        )}
        {inviteProgress && !listOpen && (
          <InviteProgress
            state={inviteProgress}
            onAction={progressAction}
            className='bottom-26'
          />
        )}
        {!inviteProgress &&
          collectionTask?.kind === 'collect' &&
          Boolean(
            collectionTask.logs?.some((entry) => entry.level === 'error')
          ) && (
            <div className='pointer-events-none absolute inset-x-0 top-0 bottom-22 [&>*]:pointer-events-auto'>
              <CollectionLog
                key={`${collectionTask.accountId}-${collectionTask.startedAt}`}
                task={collectionTask}
              />
            </div>
          )}
      </div>
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className='flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[1180px]'>
          <DialogHeader className='flex-row items-center justify-between border-b px-6 py-5 pr-12'>
            <DialogTitle>采集列表 · {talents.length}</DialogTitle>
            {inviteTasks.length > 0 && (
              <Button variant='ghost' size='sm' onClick={showProgress}>
                邀约进度
              </Button>
            )}
            <DialogDescription className='sr-only'>
              查看已采集达人并选择邀约
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            <CollectionList
              platform={platform}
              talents={talents}
              selected={selected}
              onSelect={setSelected}
              onInvite={openInvite}
              onCollect={() => setListOpen(false)}
            />
          </div>
          {inviteProgress && !composeOpen && !recordsOpen && !logsOpen && (
            <InviteProgress
              state={inviteProgress}
              onAction={progressAction}
              className='right-6 bottom-24 z-40'
            />
          )}
        </DialogContent>
      </Dialog>
      {composeOpen && (
        <InviteCompose
          open={composeOpen}
          onOpenChange={(open) => {
            setComposeOpen(open)
            if (!open) setPendingInvite(false)
          }}
          platform={platform}
          accountId={inviteAccountId}
          onAccountChange={setInviteAccountId}
          selectedIds={inviteTalentIds}
          onLogin={loginForInvite}
          onStarted={() => {
            setComposeOpen(false)
            setPendingInvite(false)
            setListOpen(true)
          }}
        />
      )}
      {logsOpen && (
        <TaskLogsDialog
          open
          onOpenChange={setLogsOpen}
          initialPlatform={platform}
        />
      )}
      {recordsOpen && (
        <RecordsDialog
          open
          onOpenChange={setRecordsOpen}
          records={store.records.filter((r) => r.platform === platform)}
        />
      )}
    </main>
  )
}
