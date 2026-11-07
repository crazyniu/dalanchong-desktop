/**
 * AI module map
 * Purpose: compose each platform's invitation workspace and its platform-scoped modal tools.
 * Entry: InvitePage reads the /invites platform search parameter from separate sidebar
 * entries; InviteWorkspace owns that platform's account tabs and modal state.
 * Flow: select an account, host its native webpage (or preview), open collection/history/
 * logs/configuration/account dialogs, and map toolbar actions to store or desktop methods.
 * Table profile actions use talent-profile.ts to open the system browser and preserve
 * the collection dialog, sharing URL construction with invitation history.
 * Toolbar dialogs mount only after openBrowserDialog finishes hiding native views.
 * Toolbar home/history actions use the same account WebView and its browser history.
 * Collection entry uses the shared supported-page allowlist and the current observed URL;
 * unsupported pages show an actionable rejection instead of starting an old capture.
 * Account tabs expose add/rename/remove through accounts.tsx's shared action dialogs;
 * right-clicking or deleting a tab targets that account without changing selection.
 * Newly added accounts log in inside their selected Tab after the management dialogs close.
 * State: selection and modal visibility are presentation concerns;
 * actual collection/invitation jobs remain in the runtime while dialogs close or tabs change.
 * Removed accounts release their selections. Closing/submitting the invitation form
 * releases its ID snapshot; temporarily leaving for login retains that pending scope.
 * Opening a new Kuaishou invitation raises saved intervals below 2000 ms to its minimum.
 * BrowserLayer owns global invitation feedback independently of this workspace;
 * completed or stopped tasks stay in history without reopening a progress card.
 * Switching platform remounts presentation state; collected rows and selection are scoped
 * to each account, while native sessions and background jobs remain retained.
 * Invariants: selecting rows changes invitation/export/delete scope; collection itself
 * never sends invitations. Navigation and dialogs cannot dismiss running task feedback.
 * Only collection makes the shown page inert and displays the preview interaction mask.
 * Collection and invitation use separate account/kind task slots. The toolbar starts
 * or stops collection only; GlobalInviteProgress owns invitation cancellation.
 * The empty-account workspace owns account creation; its bottom toolbar stays unmounted.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSearch } from '@tanstack/react-router'
import { invoke } from '@tauri-apps/api/core'
import { Pencil, Plus, Trash2, UsersRound, X } from 'lucide-react'
import { toast } from 'sonner'
import { isSupportedCollectionPage } from '@/desktop-runtime/collection-pages.mjs'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  AccountActionDialog,
  AccountsDialog,
  type AccountAction,
} from './accounts'
import {
  BrowserHost,
  FloatingToolbar,
  openBrowserDialog,
} from './browser'
import {
  browserError,
  reloadPlatform,
  traversePlatform,
  useGuestState,
} from './browser-session'
import { CollectionList } from './collection-list'
import { CollectionLog } from './collection-log'
import { type ToolbarAction, type ToolbarState } from './collection-toolbar'
import { desktop } from './desktop'
import { InviteCompose } from './invite-compose'
import { PlatformPreview } from './platform-preview'
import { RecordsDialog } from './records'
import { collectDemo, defaultFilters, defaults, stopDemo, useCommerce } from './store'
import { openTalentProfile } from './talent-profile'
import { TaskLogsDialog } from './task-logs'
import type { Account, CollectedTalent, Platform } from './types'

export function InvitePage() {
  const { platform = 'kuaishou' } = useSearch({ from: '/invites' })
  return (
    <main className='flex h-svh min-h-0 min-w-0 flex-col'>
      <InviteWorkspace key={platform} platform={platform} />
    </main>
  )
}

function InviteWorkspace({ platform }: { platform: Platform }) {
  const available = useCommerce(useShallow((s) =>
    s.accounts.filter((account) => account.platform === platform)
  ))
  const selectedAccountId = useCommerce((s) => s.selected[platform])
  const selectAccount = useCommerce((s) => s.selectAccount)
  const browserAccount =
    available.find((a) => a.id === selectedAccountId) || available[0]
  const browserAccountId = browserAccount?.id || ''
  const captured = useCommerce((s) => Boolean(s.captured[browserAccountId]))
  const pageState = useGuestState((s) => s.sessions[browserAccountId])
  const pageReady = !desktop || pageState?.status === 'ready'
  const collectionSupported =
    !desktop || isSupportedCollectionPage(platform, pageState?.url)
  const [listOpen, setListOpen] = useState(false)
  const [selectedByAccount, setSelectedByAccount] = useState<
    Record<string, string[]>
  >({})
  useEffect(() => {
    const accountIds = new Set(available.map((account) => account.id))
    setSelectedByAccount((current) => {
      const entries = Object.entries(current)
      const retained = entries.filter(([id]) => accountIds.has(id))
      return retained.length === entries.length ? current : Object.fromEntries(retained)
    })
  }, [available])
  const selected = selectedByAccount[browserAccountId] || emptySelection
  const setSelected = useCallback((ids: string[]) => {
    setSelectedByAccount((current) => ({
      ...current,
      [browserAccountId]: ids,
    }))
  }, [browserAccountId])
  const [inviteTalentIds, setInviteTalentIds] = useState<string[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
  const [inviteAccountId, setInviteAccountId] = useState('')
  const [pendingInvite, setPendingInvite] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [accountAction, setAccountAction] = useState<AccountAction | null>(null)
  const [returning, setReturning] = useState(false)
  const [starting, setStarting] = useState(false)
  // Native counts are database aggregates; preview keeps its in-memory collection.
  const countTalents = useMemo(() => {
    let previous: CollectedTalent[] | undefined
    let count = 0
    return ({ talents }: { talents: CollectedTalent[] }) => {
      if (previous !== talents) {
        previous = talents
        count = 0
        for (const talent of talents) {
          if (talent.platform === platform && talent.sourceAccountId === browserAccountId) count++
        }
      }
      return count
    }
  }, [platform, browserAccountId])
  const talentCount = useCommerce((state) => desktop
    ? state.talentCounts[browserAccountId] || 0
    : countTalents(state))
  const sendAccount = available.find((a) => a.id === inviteAccountId)
  const shownAccount = composeOpen && sendAccount ? sendAccount : browserAccount
  const collecting = useCommerce((s) => s.tasks[`${browserAccountId}:collect`]?.status === 'running')
  const inviting = useCommerce((s) => s.tasks[`${browserAccountId}:invite`]?.status === 'running')
  const collectionTask = useCommerce((s) => desktop ? undefined : s.tasks[`${browserAccountId}:collect`])
  const hasCollectionRecords =
    collectionTask?.kind === 'collect' &&
    (collecting ||
      Boolean(collectionTask.activity?.length) ||
      Boolean(collectionTask.logs?.some((entry) => entry.level === 'error')))
  const pageCollecting = useCommerce((s) => {
    return s.tasks[`${shownAccount?.id}:collect`]?.status === 'running'
  })
  const runningAccountIds = useCommerce(useShallow((s) => available
    .filter((account) => s.tasks[`${account.id}:collect`]?.status === 'running' ||
      s.tasks[`${account.id}:invite`]?.status === 'running')
    .map((account) => account.id)
  ))
  const hasRunningInvites = useCommerce((s) => Object.values(s.tasks)
    .some((task) => task.kind === 'invite' && task.status === 'running'))
  async function loginAddedAccount(account: Account) {
    setAccountAction(null)
    setAccountsOpen(false)
    const nativeAccount = {
      id: account.id,
      platform: account.platform,
      name: account.name,
    }
    // AccountActionDialog invokes this only in desktop mode. Share preparation with
    // the mounted Tab before navigating, so its initial load cannot replace login.
    await desktop!.prepareAccount(nativeAccount)
    await invoke('browser_login', { account: nativeAccount, inWorkspace: true })
  }
  async function collect() {
    if (!pageReady) return
    if (!collectionSupported) {
      toast.error('当前页面不支持采集')
      return
    }
    if (desktop && !captured) return
    setStarting(true)
    try {
      if (desktop) await desktop.collect(browserAccount.id)
      else
        collectDemo(browserAccount, {
          ...(useCommerce.getState().filters[browserAccount.id] || defaultFilters),
        })
    } catch (e) {
      toast.error(browserError(e))
    } finally {
      setStarting(false)
    }
  }
  async function stop(id: string) {
    try {
      if (desktop) await desktop.stop(id, 'collect')
      else stopDemo(id, 'collect')
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const openInvite = useCallback((ids: string[]) => {
    const store = useCommerce.getState()
    const config = store.configs[browserAccountId] || defaults
    store.saveConfig(browserAccountId, {
      ...config,
      interval: platform === 'kuaishou' ? Math.max(2000, config.interval) : config.interval,
      maxInvites: null,
    })
    setInviteTalentIds(ids)
    setInviteAccountId(browserAccountId)
    setComposeOpen(true)
  }, [browserAccountId, platform])
  const closeList = useCallback(() => setListOpen(false), [])
  function loginForInvite(id: string) {
    selectAccount(platform, id)
    setComposeOpen(false)
    setListOpen(false)
    setPendingInvite(true)
  }
  async function returnToInvite() {
    setReturning(true)
    try {
      selectAccount(platform, inviteAccountId)
      if (desktop && !(await reloadPlatform(inviteAccountId))) return
      await openBrowserDialog(() => {
        setListOpen(true)
        setComposeOpen(true)
      })
    } finally {
      setReturning(false)
    }
  }
  const toolbar: ToolbarState = {
    accountId: browserAccount?.id || '',
    view: 'collect',
    count: talentCount,
    collecting,
    inviting,
    pendingInvite: pendingInvite && inviteAccountId === browserAccount?.id,
    returning,
    navigationDisabled:
      !desktop || !pageReady || collecting || inviting || starting,
    disabled:
      !collecting &&
      (!pageReady ||
        starting ||
        (collectionSupported &&
          (Boolean(desktop && !captured) ||
            browserAccount?.status !== 'online'))),
    label: collecting
      ? '停止采集'
      : !pageReady
        ? pageState?.status === 'error'
          ? '网页未就绪'
          : '正在加载网页'
        : starting
          ? '正在启动'
          : !collectionSupported
            ? '当前页面不支持采集'
            : desktop && !captured
              ? '等待网页筛选'
              : '开始采集',
  }
  function toolbarAction(action: ToolbarAction) {
    switch (action.type) {
      case 'view':
        if (action.view === 'list') void openBrowserDialog(() => setListOpen(true))
        break
      case 'home':
        if (desktop) void reloadPlatform(browserAccount.id)
        else toast.success('当前为主页预览')
        break
      case 'back':
      case 'forward':
        void traversePlatform(browserAccount.id, action.type)
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
        void openBrowserDialog(() => setLogsOpen(true))
        break
      case 'records':
        void openBrowserDialog(() => setRecordsOpen(true))
        break
    }
  }
  return (
    <section className='relative flex min-h-0 min-w-0 flex-1 flex-col'>
      {browserAccount && (
        <FloatingToolbar state={toolbar} onAction={toolbarAction} />
      )}
      <Tabs
        value={shownAccount?.id || ''}
        onValueChange={(id) => selectAccount(platform, id)}
        className='min-h-0 min-w-0 flex-1 gap-0'
      >
        {available.length > 0 && (
          <div className='flex shrink-0 items-center border-b bg-muted/40 pr-2'>
            <TabsList
              aria-label='网页账号'
              className='h-12 min-w-0 justify-start gap-1 overflow-x-auto rounded-none bg-transparent px-2 py-1'
            >
              {available.map((account) => (
                <ContextMenu key={account.id}>
                  <ContextMenuTrigger asChild>
                    <div className='relative max-w-56 flex-none'>
                      <TabsTrigger
                        value={account.id}
                        className='h-9 w-full min-w-0 gap-2 pr-9 pl-3'
                        title={account.name}
                        aria-label={`${account.name}，${account.status === 'online' ? '已登录' : '需要登录'}`}
                      >
                        <span
                          aria-hidden='true'
                          className={`size-1.5 shrink-0 rounded-full ${account.status === 'online' ? 'bg-emerald-600' : 'bg-amber-600'}`}
                        />
                        <span className='truncate'>{account.name}</span>
                      </TabsTrigger>
                      <Button
                        variant='ghost'
                        size='icon'
                        className='absolute top-1/2 right-1 size-6 -translate-y-1/2 text-muted-foreground hover:text-destructive'
                        aria-label={`删除${account.name}`}
                        title='删除账号'
                        disabled={runningAccountIds.includes(account.id)}
                        onClick={() =>
                          setAccountAction({ type: 'remove', account })
                        }
                      >
                        <X className='size-3.5' />
                      </Button>
                    </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent
                    onCloseAutoFocus={(event) => {
                      if (accountAction) event.preventDefault()
                    }}
                  >
                    <ContextMenuItem
                      onSelect={() =>
                        setAccountAction({ type: 'rename', account })
                      }
                    >
                      <Pencil />
                      编辑名称
                    </ContextMenuItem>
                    <ContextMenuItem
                      variant='destructive'
                      disabled={runningAccountIds.includes(account.id)}
                      onSelect={() =>
                        setAccountAction({ type: 'remove', account })
                      }
                    >
                      <Trash2 />
                      删除账号
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              ))}
            </TabsList>
            <Button
              variant='ghost'
              size='icon'
              className='size-8 shrink-0 text-muted-foreground'
              aria-label='添加账号'
              title='添加账号'
              onClick={() => setAccountAction({ type: 'add' })}
            >
              <Plus className='size-4' />
            </Button>
            <Button
              variant='ghost'
              size='icon'
              className='ml-auto size-8 shrink-0 text-muted-foreground'
              aria-label='管理账号'
              title='管理账号'
              onClick={() => setAccountsOpen(true)}
            >
              <UsersRound className='size-4' />
            </Button>
          </div>
        )}
        <TabsContent
          value={shownAccount?.id || ''}
          className='relative flex min-h-0 flex-1 flex-col'
          data-testid='platform-workspace'
        >
          <div className='flex min-h-0 flex-1 flex-col' inert={pageCollecting}>
            {shownAccount ? (
              desktop ? (
                <BrowserHost account={shownAccount} />
              ) : (
                <PlatformPreview key={shownAccount.id} account={shownAccount} />
              )
            ) : (
              <div className='grid flex-1 place-content-center justify-items-center gap-4'>
                <UsersRound className='size-9 text-muted-foreground' />
                <p>暂无账号</p>
                <Button onClick={() => setAccountAction({ type: 'add' })}>
                  <Plus />
                  添加账号
                </Button>
              </div>
            )}
          </div>
          {!desktop && pageCollecting && (
            <div
              className='absolute inset-0 z-20 cursor-wait bg-slate-950/15'
              role='status'
              aria-label='采集中'
            />
          )}
          {!desktop && hasCollectionRecords && !hasRunningInvites && (
            <div className='pointer-events-none absolute inset-x-0 top-0 bottom-22 [&>*]:pointer-events-auto'>
              <CollectionLog
                key={`${collectionTask.accountId}-${collectionTask.startedAt}`}
                task={collectionTask}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>
      <AccountsDialog
        platform={platform}
        open={accountsOpen}
        onOpenChange={setAccountsOpen}
        onAdded={loginAddedAccount}
      />
      <AccountActionDialog
        platform={platform}
        action={accountAction}
        onClose={() => setAccountAction(null)}
        onAdded={loginAddedAccount}
      />
      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className='flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[1180px]'>
          <DialogHeader className='flex-row items-center justify-between border-b px-6 py-5 pr-12'>
            <DialogTitle>采集列表 · {talentCount}</DialogTitle>
            <DialogDescription className='sr-only'>
              查看已采集达人并选择邀约
            </DialogDescription>
          </DialogHeader>
          <div className='min-h-0 flex-1 overflow-y-auto'>
            {listOpen && browserAccount && (
              <CollectionList
                key={browserAccount.id}
                platform={platform}
                accountId={browserAccount.id}
                selected={selected}
                onSelect={setSelected}
                onInvite={openInvite}
                onCollect={closeList}
                onView={openTalentProfile}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {composeOpen && (
        <InviteCompose
          open={composeOpen}
          onOpenChange={(open) => {
            setComposeOpen(open)
            if (!open) {
              setPendingInvite(false)
              setInviteTalentIds([])
            }
          }}
          platform={platform}
          accountId={inviteAccountId}
          selectedIds={inviteTalentIds}
          onLogin={loginForInvite}
          onStarted={() => {
            setComposeOpen(false)
            setPendingInvite(false)
            setInviteTalentIds([])
            setListOpen(true)
          }}
        />
      )}
      {logsOpen && browserAccount && (
        <TaskLogsDialog
          key={browserAccount.id}
          open
          onOpenChange={setLogsOpen}
          platform={platform}
          accountId={browserAccount.id}
        />
      )}
      {recordsOpen && browserAccount && (
        <PlatformRecordsDialog
          platform={platform}
          accountId={browserAccount.id}
          onOpenChange={setRecordsOpen}
        />
      )}
    </section>
  )
}

const emptySelection: string[] = []

function PlatformRecordsDialog({
  platform,
  accountId,
  onOpenChange,
}: {
  platform: Platform
  accountId: string
  onOpenChange: (open: boolean) => void
}) {
  const records = useCommerce((s) => s.records)
  const filtered = useMemo(
    () => records.filter((record) => record.platform === platform && record.accountId === accountId),
    [records, platform, accountId]
  )
  return <RecordsDialog open onOpenChange={onOpenChange} records={filtered} scope={{ platform, accountId }} />
}
