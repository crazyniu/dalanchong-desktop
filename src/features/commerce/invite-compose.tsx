import { useState } from 'react'
import {
  ChevronDown,
  LogIn,
  Play,
  RotateCw,
  Settings2,
  Square,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { browserError, retryGuest, useGuestState } from './browser-session'
import { desktop } from './desktop'
import { Choice } from './shared'
import { defaults, startDemo, stopDemo, useCommerce } from './store'
import type { Platform, InviteConfig } from './types'

export function InviteCompose({
  open,
  onOpenChange,
  platform,
  accountId,
  onAccountChange,
  selectedIds,
  onLogin,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: Platform
  accountId: string
  onAccountChange: (id: string) => void
  selectedIds: string[]
  onLogin: (id: string) => void
  onStarted: () => void
}) {
  const store = useCommerce()
  const account = store.accounts.find((a) => a.id === accountId)
  const available = store.accounts.filter((a) => a.platform === platform)
  const config = store.configs[accountId] || defaults
  const pageState = useGuestState((s) => s.sessions[accountId])
  const pageReady = !desktop || pageState?.status === 'ready'
  const task = store.tasks[accountId]
  const running = task?.status === 'running'
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const save = (partial: Partial<InviteConfig>) =>
    store.saveConfig(accountId, { ...config, ...partial })
  async function start() {
    if (!pageReady) return
    const ids = [
      ...new Set(
        config.products
          .trim()
          .split(/[\s,，、;；]+/)
          .filter(Boolean)
      ),
    ]
    const limit = platform === 'douyin' ? 5 : 100
    if (
      !ids.length ||
      ids.length > limit ||
      ids.some((id) => !/^\d+$/.test(id))
    ) {
      setError(`请填写 1–${limit} 个数字商品 ID`)
      return
    }
    const length = Array.from(config.message.trim()).length
    if (!length || (platform === 'douyin' && length > 150)) {
      setError(
        platform === 'douyin' ? '请填写 150 字以内的话术' : '请填写邀约话术'
      )
      return
    }
    if (
      platform === 'douyin' &&
      !config.phone.trim() &&
      !config.wechat.trim()
    ) {
      setError('请填写手机号或微信号')
      return
    }
    if (
      !Number.isInteger(config.interval) ||
      config.interval < 500 ||
      config.interval > 60000 ||
      !Number.isInteger(config.maxInvites) ||
      config.maxInvites < 1
    ) {
      setError('邀约上限须为正整数，间隔为 500–60000 毫秒')
      return
    }
    setError('')
    setStarting(true)
    try {
      if (desktop)
        await desktop.start(accountId, { ...config }, [...selectedIds])
      else startDemo(account!, [...selectedIds], { ...config })
      onStarted()
    } catch (e) {
      setError(browserError(e))
    } finally {
      setStarting(false)
    }
  }
  async function refreshQuota() {
    setRefreshing(true)
    setError('')
    try {
      if (desktop) await desktop.refreshAccount(accountId)
    } catch (e) {
      setError(browserError(e))
    } finally {
      setRefreshing(false)
    }
  }
  async function stop() {
    try {
      if (desktop) await desktop.stop(accountId)
      else stopDemo(accountId)
    } catch (e) {
      setError(browserError(e))
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='gap-0 sm:max-w-[460px]'>
        <SheetHeader className='border-b p-6'>
          <SheetTitle>
            邀约所选达人{' '}
            <Badge variant='secondary' className='ml-2'>
              {selectedIds.length} 位
            </Badge>
          </SheetTitle>
          <SheetDescription className='sr-only'>
            选择发送账号并填写邀约内容
          </SheetDescription>
        </SheetHeader>
        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-6'>
          <div className='space-y-2'>
            <Label>发送账号</Label>
            <Choice
              label='发送账号'
              value={accountId}
              onChange={(id) => {
                onAccountChange(id)
                setError('')
              }}
              options={available.map((a) => ({ value: a.id, label: a.name }))}
              className='w-full'
            />
            {account && (
              <div className='flex items-center justify-between gap-2 pt-1 text-sm'>
                <span
                  className={
                    account.status === 'online'
                      ? 'text-emerald-700'
                      : 'text-amber-700'
                  }
                >
                  {account.status === 'online' ? '已登录' : '需要登录'}
                </span>
                {account.status === 'online' ? (
                  <span className='text-muted-foreground'>
                    {account.quotaError
                      ? '额度待刷新'
                      : `剩余 ${account.quota} 次`}
                  </span>
                ) : (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => onLogin(account.id)}
                  >
                    <LogIn />
                    登录账号
                  </Button>
                )}
              </div>
            )}
            {account?.quotaError && (
              <div className='space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3'>
                <p role='alert' className='text-sm break-words text-amber-900'>
                  额度读取失败：{account.quotaError}
                </p>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={refreshing}
                  onClick={refreshQuota}
                >
                  <RotateCw className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? '正在刷新' : '刷新额度'}
                </Button>
              </div>
            )}
          </div>
          {desktop && pageState?.status === 'error' && (
            <div className='space-y-2'>
              <p role='alert' className='text-sm text-destructive'>
                {pageState.error}
              </p>
              <Button
                variant='outline'
                size='sm'
                onClick={() => retryGuest(accountId)}
              >
                重新打开网页
              </Button>
            </div>
          )}
          <div className='space-y-2'>
            <Label htmlFor='invite-products'>商品 ID</Label>
            <Textarea
              id='invite-products'
              value={config.products.replace(/[ \t,，、;；]+/g, '\n')}
              placeholder='每行一个商品 ID'
              rows={3}
              className='h-24 resize-y'
              disabled={running}
              onChange={(e) => save({ products: e.target.value })}
            />
          </div>
          <div className='space-y-2'>
            <div className='flex items-center justify-between'>
              <Label htmlFor='invite-message'>邀约话术</Label>
              {platform === 'douyin' && (
                <span className='text-sm text-muted-foreground'>
                  {Array.from(config.message.trim()).length} / 150
                </span>
              )}
            </div>
            <Textarea
              id='invite-message'
              value={config.message}
              rows={4}
              className='min-h-28 resize-none leading-6'
              disabled={running}
              onChange={(e) => save({ message: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='invite-phone'>手机号</Label>
              <Input
                id='invite-phone'
                value={config.phone}
                placeholder={
                  platform === 'kuaishou' ? '留空使用后台手机号' : '填写手机号'
                }
                disabled={running}
                onChange={(e) => save({ phone: e.target.value })}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='invite-wechat'>微信号</Label>
              <Input
                id='invite-wechat'
                value={config.wechat}
                placeholder={
                  platform === 'kuaishou' ? '留空使用后台微信号' : '填写微信号'
                }
                disabled={running}
                onChange={(e) => save({ wechat: e.target.value })}
              />
            </div>
          </div>
          <Collapsible>
            <CollapsibleTrigger asChild>
              <Button
                variant='ghost'
                className='w-full justify-between px-0 text-muted-foreground'
              >
                <span className='flex items-center gap-2'>
                  <Settings2 />
                  发送设置
                </span>
                <ChevronDown />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className='grid grid-cols-2 gap-3 pt-3'>
              <div className='space-y-2'>
                <Label htmlFor='invite-limit'>本次邀约上限</Label>
                <Input
                  id='invite-limit'
                  type='number'
                  min={1}
                  value={config.maxInvites}
                  disabled={running}
                  onChange={(e) => save({ maxInvites: Number(e.target.value) })}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='invite-interval'>间隔（毫秒）</Label>
                <Input
                  id='invite-interval'
                  type='number'
                  min={500}
                  max={60000}
                  value={config.interval}
                  disabled={running}
                  onChange={(e) => save({ interval: Number(e.target.value) })}
                />
              </div>
            </CollapsibleContent>
          </Collapsible>
          {task && (task.kind !== 'collect' || running) && (
            <div className='space-y-3 rounded-lg border p-4'>
              <div className='flex justify-between text-sm'>
                <span>
                  {running
                    ? task.kind === 'collect'
                      ? '正在采集'
                      : '正在邀约'
                    : task.status === 'done'
                      ? '上次任务已完成'
                      : '上次任务已停止'}
                </span>
                <span className='tabular-nums'>
                  {task.processed} / {task.total}
                </span>
              </div>
              <Progress
                value={task.total ? (task.processed / task.total) * 100 : 0}
                className='h-1.5'
              />
              <p className='text-sm text-muted-foreground'>{task.current}</p>
            </div>
          )}
          {error && (
            <p role='alert' className='text-sm text-red-600'>
              {error}
            </p>
          )}
        </div>
        <SheetFooter className='border-t p-6'>
          <Button
            className='h-10 w-full'
            disabled={
              !running &&
              (!pageReady ||
                !account ||
                account.status !== 'online' ||
                Boolean(account.quotaError) ||
                account.quota === 0 ||
                starting ||
                !selectedIds.length)
            }
            onClick={running ? stop : start}
          >
            {running ? (
              <Square className='size-3 fill-current' />
            ) : (
              <Play className='size-4 fill-current' />
            )}
            {running
              ? '停止当前任务'
              : starting
                ? '正在启动'
                : !pageReady
                  ? pageState?.status === 'error'
                    ? '网页未就绪'
                    : '正在加载网页'
                  : account?.status !== 'online'
                    ? '请先登录账号'
                    : account.quotaError
                      ? '刷新额度后重试'
                      : account.quota === 0
                        ? '额度已用完'
                        : `开始邀约 ${Math.min(selectedIds.length, config.maxInvites)} 位`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
