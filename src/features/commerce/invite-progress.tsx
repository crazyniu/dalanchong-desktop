import { CircleCheck, CirclePause, LoaderCircle, Square, X } from 'lucide-react'
import { create } from 'zustand'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { Platform, Task } from './types'

export const useInviteProgressVisibility = create<{
  dismissed: string[]
  dismiss: (keys: string[]) => void
  show: (keys: string[]) => void
}>((set) => ({
  dismissed: [],
  dismiss: (keys) => set((s) => ({ dismissed: [...s.dismissed, ...keys] })),
  show: (keys) =>
    set((s) => ({
      dismissed: s.dismissed.filter((key) => !keys.includes(key)),
    })),
}))

export type InviteProgressState = {
  platform: Platform
  tasks: { name: string; task: Task }[]
}

export type InviteProgressAction =
  | { type: 'close' }
  | { type: 'stop'; accountId: string }

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
  const running = state.tasks.some(({ task }) => task.status === 'running')
  const stopped = state.tasks.some(({ task }) => task.status === 'stopped')
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
        {running ? (
          <LoaderCircle className='size-4 shrink-0 motion-safe:animate-spin' />
        ) : stopped ? (
          <CirclePause className='size-4 shrink-0 text-amber-700' />
        ) : (
          <CircleCheck className='size-4 shrink-0 text-emerald-700' />
        )}
        <h3 className='text-sm font-semibold' aria-live='polite'>
          {running ? '正在邀约' : stopped ? '邀约已停止' : '邀约已完成'}
        </h3>
        <span className='ml-auto text-sm text-muted-foreground tabular-nums'>
          {running
            ? `${totals.processed} / ${totals.total}`
            : `已处理 ${totals.processed} 位`}
        </span>
        <Button
          size='icon'
          variant='ghost'
          className='-mr-1 size-8 shrink-0 text-muted-foreground'
          aria-label='关闭邀约进度'
          onClick={() => onAction({ type: 'close' })}
        >
          <X />
        </Button>
      </div>
      <div className='space-y-3 px-4 pt-2 pb-4'>
        {running && (
          <Progress
            aria-label='邀约处理进度'
            value={totals.total ? (totals.processed / totals.total) * 100 : 0}
            className='h-1.5'
          />
        )}
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
          {state.tasks.map(({ name, task }) => (
            <div key={task.accountId} className='flex items-center gap-3'>
              <div className='min-w-0 flex-1 text-sm'>
                <div className='flex items-center gap-2'>
                  <span className='truncate font-medium' title={name}>
                    {name}
                  </span>
                  {state.tasks.length > 1 && (
                    <span className='shrink-0 text-muted-foreground tabular-nums'>
                      {task.status === 'running'
                        ? `${task.processed} / ${task.total}`
                        : task.status === 'done'
                          ? '已完成'
                          : '已停止'}
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
              {task.status === 'running' && (
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
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
