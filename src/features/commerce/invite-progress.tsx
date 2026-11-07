/**
 * AI module map
 * Purpose: display fixed invitation progress for one or multiple running account tasks.
 * Entry: InviteProgress receives task snapshots and emits account stop actions;
 * TaskOverlayContent is also the payload contract used by the native logs view.
 * State: BrowserLayer supplies running invitation tasks from every platform, independently
 * of the active route, account, or dialog. The card has no dismiss action and remains
 * visible until all supplied tasks complete or stop.
 * Invariants: stop identifies a concrete account; presentation never owns runtime jobs.
 * Progress/counts come from runtime tasks, not local timers.
 * Invitation payloads contain display fields only; task logs and collection filters
 * stay with their owners instead of crossing the native overlay bridge on every tick.
 */

import { LoaderCircle, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { PlatformIcon } from './shared'
import type { Platform, Task } from './types'

type InviteProgressTask = Pick<Task,
  'accountId' | 'startedAt' | 'processed' | 'total' | 'success' |
  'skipped' | 'failed' | 'review' | 'current'
>
export type InviteProgressState = {
  tasks: { name: string; platform: Platform; task: InviteProgressTask }[]
}

export type InviteProgressAction = { type: 'stop'; accountId: string }

export type TaskOverlayContent =
  | { kind: 'collect'; task: Task }
  | ({ kind: 'invite' } & InviteProgressState)

export function InviteProgress({
  state,
  onAction,
  className,
}: {
  state: InviteProgressState
  onAction: (action: InviteProgressAction) => void
  className?: string
}) {
  const totals = state.tasks.reduce(
    (sum, { task }) => ({
      processed: sum.processed + task.processed,
      total: sum.total + task.total,
      success: sum.success + task.success,
      skipped: sum.skipped + task.skipped,
      failed: sum.failed + task.failed,
      review: sum.review + task.review,
    }),
    { processed: 0, total: 0, success: 0, skipped: 0, failed: 0, review: 0 }
  )

  return (
    <section
      aria-label='邀约进度'
      data-slot='invite-progress'
      className={cn(
        'absolute right-4 bottom-4 z-30 w-[380px] max-w-[calc(100%-2rem)] rounded-xl bg-background text-foreground shadow-[0_8px_32px_-8px_rgb(15_23_42/0.3)]',
        className
      )}
    >
      <div className='flex items-center gap-2 px-4 pt-3'>
        <LoaderCircle className='size-4 shrink-0 motion-safe:animate-spin' />
        <h3 className='text-sm font-semibold' aria-live='polite'>
          正在邀约
        </h3>
        <span className='ml-auto text-sm text-muted-foreground tabular-nums'>
          {totals.processed} / {totals.total}
        </span>
      </div>
      <div className='space-y-3 px-4 pt-2 pb-4'>
        <Progress
          aria-label='邀约处理进度'
          value={totals.total ? (totals.processed / totals.total) * 100 : 0}
          className='h-1.5'
        />
        <div className='flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums'>
          <span className='font-medium text-emerald-700'>
            已邀约 {totals.success}
          </span>
          <span className='text-muted-foreground'>跳过 {totals.skipped}</span>
          {totals.failed > 0 && (
            <span className='text-destructive'>失败 {totals.failed}</span>
          )}
          {totals.review > 0 && (
            <span className='text-amber-700'>待核实 {totals.review}</span>
          )}
        </div>
        <div className='max-h-40 space-y-2 overflow-y-auto'>
          {state.tasks.map(({ name, platform, task }) => (
            <div key={task.accountId} className='flex items-center gap-3'>
              <PlatformIcon platform={platform} />
              <div className='min-w-0 flex-1 text-sm'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium' title={name}>
                    {name}
                  </span>
                  {state.tasks.length > 1 && (
                    <span className='shrink-0 text-muted-foreground tabular-nums'>
                      {task.processed} / {task.total}
                    </span>
                  )}
                </div>
                <p
                  className='truncate text-muted-foreground'
                  title={task.current}
                >
                  {task.current}
                </p>
              </div>
              <Button
                size='sm'
                variant='outline'
                onClick={() =>
                  onAction({ type: 'stop', accountId: task.accountId })
                }
              >
                <Square className='size-3' />
                停止
              </Button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
