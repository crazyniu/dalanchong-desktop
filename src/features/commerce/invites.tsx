import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  History,
  LogIn,
  Play,
  RotateCw,
  ScrollText,
  Square,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BrowserHost } from './browser'
import { browserError, reloadPlatform, useGuestState } from './browser-session'
import { CollectionList } from './collection-list'
import { CollectionLog } from './collection-log'
import { desktop } from './desktop'
import { InviteCompose } from './invite-compose'
import { PlatformPreview } from './platform-preview'
import { RecordsDialog } from './records'
import { collectDemo, defaultFilters, stopDemo, useCommerce } from './store'
import { TaskLogsDialog } from './task-logs'
import type { Platform } from './types'

export function InvitePage({ platform }: { platform: Platform }) {
  const store = useCommerce()
  const available = store.accounts.filter((a) => a.platform === platform)
  const browserAccount =
    available.find((a) => a.id === store.selected[platform]) || available[0]
  const pageState = useGuestState((s) => s.sessions[browserAccount?.id])
  const pageReady = !desktop || pageState?.status === 'ready'
  const [view, setView] = useState('collect')
  const [selected, setSelected] = useState<string[]>([])
  const [composeOpen, setComposeOpen] = useState(false)
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
  const inviteTasks = available
    .map((a) => ({ account: a, task: store.tasks[a.id] }))
    .filter((x) => x.task && x.task.kind !== 'collect')
  async function collect() {
    if (!pageReady) return
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
  function openInvite() {
    setInviteAccountId(inviteAccountId || browserAccount?.id || '')
    setComposeOpen(true)
  }
  function loginForInvite(id: string) {
    store.selectAccount(platform, id)
    setComposeOpen(false)
    setView('collect')
    setPendingInvite(true)
  }
  async function returnToInvite() {
    setReturning(true)
    try {
      store.selectAccount(platform, inviteAccountId)
      if (desktop && !(await reloadPlatform(inviteAccountId))) return
      setView('list')
      setComposeOpen(true)
    } finally {
      setReturning(false)
    }
  }
  return (
    <main className='flex min-h-0 flex-1 flex-col'>
      <div
        className='page-toolbar workspace-toolbar shrink-0 border-b'
        data-testid='collection-toolbar'
      >
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value='collect'>采集达人</TabsTrigger>
            <TabsTrigger value='list'>
              采集列表{' '}
              <span className='ml-1 tabular-nums'>{talents.length}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {view === 'collect' && (
          <>
            {collecting ? (
              <span className='text-sm text-muted-foreground tabular-nums'>
                已采集 {collectionTask.collected}
              </span>
            ) : (
              collectionTask?.kind === 'collect' && (
                <span
                  className='max-w-56 truncate text-sm text-muted-foreground'
                  title={collectionTask.current}
                >
                  {collectionTask.current}
                </span>
              )
            )}
            <div className='ml-auto flex items-center gap-3'>
              {browserAccount && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='max-w-48 gap-2 text-muted-foreground'
                      aria-label='当前网页账号'
                    >
                      <UserRound className='size-4' />
                      <span className='truncate'>{browserAccount.name}</span>
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${browserAccount.status === 'online' ? 'bg-emerald-600' : 'bg-amber-600'}`}
                      />
                      <ChevronDown className='size-3' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuLabel>网页账号</DropdownMenuLabel>
                    {available.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => store.selectAccount(platform, a.id)}
                      >
                        {a.name}
                        {a.id === browserAccount.id && (
                          <Badge variant='secondary' className='ml-auto'>
                            当前
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem asChild>
                      <Link to='/accounts'>管理账号</Link>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {browserAccount && (
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label='返回达人页面'
                  title='返回达人页面'
                  onClick={() =>
                    desktop
                      ? reloadPlatform(browserAccount.id)
                      : toast.success('网页预览已刷新')
                  }
                >
                  <RotateCw className='size-4' />
                </Button>
              )}
              {pendingInvite ? (
                <Button size='sm' disabled={returning} onClick={returnToInvite}>
                  {returning ? '正在打开' : '返回邀约'}
                </Button>
              ) : (
                browserAccount && (
                  <Button
                    size='sm'
                    disabled={
                      !collecting &&
                      (!pageReady ||
                        browserAccount.status !== 'online' ||
                        starting ||
                        collectionTask?.status === 'running')
                    }
                    onClick={() =>
                      collecting ? stop(browserAccount.id) : collect()
                    }
                  >
                    {collecting ? (
                      <Square className='size-3 fill-current' />
                    ) : (
                      <Play className='size-3 fill-current' />
                    )}
                    {collecting
                      ? '停止采集'
                      : !pageReady
                        ? pageState?.status === 'error'
                          ? '网页未就绪'
                          : '正在加载网页'
                        : starting
                          ? '正在启动'
                          : '开始采集'}
                  </Button>
                )
              )}
            </div>
          </>
        )}
        <Button
          variant='ghost'
          size='sm'
          className={
            view === 'list'
              ? 'ml-auto text-muted-foreground'
              : 'text-muted-foreground'
          }
          onClick={() => setLogsOpen(true)}
        >
          <ScrollText />
          错误日志
        </Button>
        <Button
          variant='ghost'
          size='sm'
          className='text-muted-foreground'
          onClick={() => setRecordsOpen(true)}
        >
          <History />
          邀约记录
        </Button>
      </div>
      <div
        className='relative flex min-h-0 flex-1 flex-col'
        data-testid='platform-workspace'
      >
        {(view === 'collect' || composeOpen) && (
          <div
            className={
              view === 'collect'
                ? 'flex min-h-0 flex-1 flex-col'
                : 'absolute inset-0 flex flex-col'
            }
          >
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
        )}
        {view === 'collect' &&
          collectionTask?.kind === 'collect' &&
          Boolean(
            collectionTask.logs?.some((entry) => entry.level === 'error')
          ) && (
            <CollectionLog
              key={`${collectionTask.accountId}-${collectionTask.startedAt}`}
              task={collectionTask}
            />
          )}
        {view === 'list' && (
          <div className='relative z-20 min-h-0 flex-1 overflow-y-auto bg-white'>
            {inviteTasks.length > 0 && (
              <div className='space-y-3 border-b bg-muted/20 px-6 py-4'>
                {inviteTasks.map(({ account, task }) => (
                  <div
                    key={account.id}
                    className='flex items-center gap-4 text-sm'
                  >
                    <span className='w-40 truncate font-medium'>
                      {account.name}
                    </span>
                    <Badge
                      variant={
                        task.status === 'running' ? 'default' : 'secondary'
                      }
                      className='font-normal'
                    >
                      {task.status === 'running'
                        ? '邀约中'
                        : task.status === 'done'
                          ? '已完成'
                          : '已停止'}
                    </Badge>
                    <Progress
                      value={
                        task.total ? (task.processed / task.total) * 100 : 0
                      }
                      className='h-1.5 w-28'
                    />
                    <span className='text-muted-foreground tabular-nums'>
                      {task.processed} / {task.total}
                    </span>
                    <span className='text-emerald-700'>
                      已邀约 {task.success}
                    </span>
                    <span className='text-muted-foreground'>
                      跳过 {task.skipped}
                    </span>
                    {task.review > 0 && (
                      <span className='text-amber-700'>
                        待核实 {task.review}
                      </span>
                    )}
                    <span
                      className='min-w-0 flex-1 truncate text-muted-foreground'
                      title={task.current}
                    >
                      {task.current}
                    </span>
                    {task.status === 'running' && (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => stop(account.id)}
                      >
                        <Square className='size-3' />
                        停止
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <CollectionList
              platform={platform}
              talents={talents}
              selected={selected}
              onSelect={setSelected}
              onInvite={openInvite}
              onCollect={() => setView('collect')}
            />
          </div>
        )}
      </div>
      <InviteCompose
        open={composeOpen}
        onOpenChange={(open) => {
          setComposeOpen(open)
          if (!open) setPendingInvite(false)
        }}
        platform={platform}
        accountId={inviteAccountId}
        onAccountChange={setInviteAccountId}
        selectedIds={selected}
        onLogin={loginForInvite}
        onStarted={() => {
          setComposeOpen(false)
          setPendingInvite(false)
          setView('list')
        }}
      />
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
