/**
 * AI module map
 * Purpose: collect invitation settings for the current collection account before a job.
 * Entry: InviteCompose is a controlled sheet opened by InvitePage with selected talent IDs.
 * Flow: load/edit account configuration, observe guest readiness, persist settings, then
 * call desktop.start or the preview simulator only after the user's start action.
 * State: the fixed sending account and open state are parent-owned; config/busy/error is local.
 * The task subscription selects invitation progress only; concurrent collection remains
 * independent. Logs and saved filters
 * do not redraw the form, and completed task snapshots do not render here.
 * Invariants: maxInvites is optional and null means unlimited by user choice. The send
 * response decides platform limits; cached quota never gates this form. Login/readiness
 * and in-progress controls must reflect the selected sender; changing the form must
 * not mutate an already-started job snapshot. Invitation intervals start at 2000 ms
 * for Kuaishou and 5000 ms for Douyin; the workspace applies this floor when opening.
 */

import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { LogIn, Play, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { defaults, startDemo, stopDemo, useCommerce } from './store'
import type { Platform, InviteConfig } from './types'

export function InviteCompose({
  open,
  onOpenChange,
  platform,
  accountId,
  selectedIds,
  onLogin,
  onStarted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: Platform
  accountId: string
  selectedIds: string[]
  onLogin: (id: string) => void
  onStarted: () => void
}) {
  const account = useCommerce((s) => s.accounts.find((a) => a.id === accountId))
  const minimumInterval = platform === 'kuaishou' ? 2000 : 5000
  const config = useCommerce((s) => s.configs[accountId]) || { ...defaults, interval: minimumInterval }
  const saveConfig = useCommerce((s) => s.saveConfig)
  const pageState = useGuestState((s) => s.sessions[accountId])
  const pageReady = !desktop || pageState?.status === 'ready'
  const task = useCommerce(useShallow((s) => {
    const current = s.tasks[`${accountId}:invite`]
    return current?.status === 'running' ? {
      processed: current.processed,
      total: current.total,
      current: current.current,
    } : undefined
  }))
  const running = Boolean(task)
  const [error, setError] = useState('')
  const [starting, setStarting] = useState(false)
  const save = (partial: Partial<InviteConfig>) =>
    saveConfig(accountId, { ...config, ...partial })
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
      config.interval < minimumInterval ||
      config.interval > 60000
    ) {
      setError(`间隔为 ${minimumInterval}–60000 毫秒`)
      return
    }
    if (
      config.maxInvites != null &&
      (!Number.isSafeInteger(config.maxInvites) || config.maxInvites < 1)
    ) {
      setError('最大邀约数须为正整数，留空不限制')
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
  async function stop() {
    try {
      if (desktop) await desktop.stop(accountId, 'invite')
      else stopDemo(accountId, 'invite')
    } catch (e) {
      setError(browserError(e))
    }
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className='gap-0 sm:max-w-[460px]'>
        <SheetHeader className='border-b p-6'>
          <SheetTitle className='flex flex-wrap items-center gap-3 pr-4'>
            邀约达人
          </SheetTitle>
          <SheetDescription className='sr-only'>
            填写邀约内容
          </SheetDescription>
        </SheetHeader>
        <div className='min-h-0 flex-1 space-y-5 overflow-y-auto p-6'>
          {account && account.status !== 'online' && (
            <div className='flex items-center justify-between gap-2 pt-1 text-sm'>
              <span className='text-amber-700'>需要登录</span>
              <Button
                size='sm'
                variant='outline'
                onClick={() => onLogin(account.id)}
              >
                <LogIn />
                登录账号
              </Button>
            </div>
          )}
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
              disabled={running || starting}
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
              disabled={running || starting}
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
                disabled={running || starting}
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
                disabled={running || starting}
                onChange={(e) => save({ wechat: e.target.value })}
              />
            </div>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='space-y-2'>
              <Label htmlFor='invite-limit'>最大邀约数</Label>
              <Input
                id='invite-limit'
                type='number'
                min={1}
                step={1}
                value={config.maxInvites ?? ''}
                placeholder='不限制'
                disabled={running || starting}
                onChange={(e) =>
                  save({
                    maxInvites:
                      e.target.value === '' ? null : Number(e.target.value),
                  })
                }
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='invite-interval'>邀约间隔（毫秒）</Label>
              <Input
                id='invite-interval'
                type='number'
                min={minimumInterval}
                max={60000}
                value={config.interval}
                disabled={running || starting}
                onChange={(e) => save({ interval: Number(e.target.value) })}
              />
            </div>
          </div>
          {task && (
            <div className='space-y-3 rounded-lg border p-4'>
              <div className='flex justify-between text-sm'>
                <span>正在邀约</span>
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
              ? '停止邀约'
              : starting
                ? '正在启动'
                : !pageReady
                  ? pageState?.status === 'error'
                    ? '网页未就绪'
                    : '正在加载网页'
                  : account?.status !== 'online'
                    ? '请先登录账号'
                    : `开始邀约 ${Math.min(selectedIds.length, config.maxInvites ?? selectedIds.length)} 位`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
