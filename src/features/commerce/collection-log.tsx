/**
 * AI module map
 * Purpose: show live collection activity and errors in a translucent terminal card.
 * Entry: CollectionLog receives a Task snapshot; native log-overlay.tsx also renders it.
 * Flow: merge session activity with error logs chronologically, show the last 200 rows,
 * and use response-details.tsx for diagnostic response details. Before the first row arrives,
 * a running task's current step fills the terminal.
 * State: scroll refs retain the user's position and whether new rows should be followed;
 * the caller's account/start-time key resets this state for a new task.
 * Invariants: scrolling up suspends following; collapsing never changes task execution,
 * session activity, or persisted diagnostics. Native dimensions stay below its 500px cap.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Minus, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ResponseDetails } from './response-details'
import type { Task, TaskLog } from './types'

const logColors: Record<TaskLog['level'], string> = {
  info: 'text-slate-200',
  success: 'text-emerald-300',
  error: 'text-red-300',
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

export function CollectionLog({ task }: { task: Task }) {
  const [collapsed, setCollapsed] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const scrollPosition = useRef(0)
  const logs = useMemo(
    () =>
      [
        ...(task.activity || []),
        ...(task.logs || []).filter((entry) => entry.level === 'error'),
      ]
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        .slice(-200),
    [task.activity, task.logs]
  )
  const entries: TaskLog[] =
    logs.length || task.status !== 'running'
      ? logs
      : [
          {
            time: task.startedAt || '',
            level: 'info',
            message: task.current || '采集中',
          },
        ]

  useLayoutEffect(() => {
    if (viewport.current && follow.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [logs, task.current, collapsed])

  useLayoutEffect(() => {
    if (!collapsed && viewport.current && !follow.current)
      viewport.current.scrollTop = scrollPosition.current
  }, [collapsed])

  if (!entries.length) return null
  if (collapsed)
    return (
      <Button
        variant='secondary'
        className='dark absolute right-4 bottom-4 z-30 border border-border bg-background/75 text-foreground shadow-lg backdrop-blur-md hover:bg-background/85'
        aria-label='展开采集记录'
        onClick={() => setCollapsed(false)}
      >
        <ScrollText />
        采集记录 · 已采集 {task.collected}
      </Button>
    )

  return (
    <Card
      className='dark absolute right-4 bottom-4 z-30 w-[440px] max-w-[calc(100%_-_32px)] gap-0 overflow-hidden border-border bg-background/75 py-0 text-foreground shadow-xl backdrop-blur-md'
      data-testid='collection-log'
    >
      <CardHeader className='flex flex-row items-center gap-3 border-b border-border px-3 py-3'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          {task.status === 'running' ? (
            <LoaderCircle className='size-4 animate-spin' />
          ) : (
            <ScrollText className='size-4' />
          )}
          采集记录
        </CardTitle>
        <span className='ml-auto text-sm text-muted-foreground tabular-nums'>
          已采集 {task.collected}
        </span>
        <Button
          variant='ghost'
          size='icon'
          className='size-7 text-slate-200 hover:bg-white/10 hover:text-white'
          aria-label='收起采集记录'
          onClick={() => setCollapsed(true)}
        >
          <Minus />
        </Button>
      </CardHeader>
      <CardContent
        ref={viewport}
        role='log'
        aria-label='采集记录'
        aria-live='polite'
        onScroll={(event) => {
          const node = event.currentTarget
          scrollPosition.current = node.scrollTop
          follow.current =
            node.scrollHeight - node.scrollTop - node.clientHeight <= 12
        }}
        className='max-h-[360px] min-h-24 space-y-1 overflow-y-auto overscroll-contain px-3 py-3 font-mono text-sm leading-6'
      >
        {entries.map((entry) => (
          <div
            key={`${entry.time}-${entry.level}-${entry.message}`}
            className='flex items-start gap-2'
          >
            <time
              className='shrink-0 text-muted-foreground tabular-nums'
              dateTime={entry.time || undefined}
            >
              {entry.time
                ? timeFormat.format(new Date(entry.time))
                : '—'}
            </time>
            <div className='min-w-0 flex-1'>
              <p
                className={`break-words whitespace-pre-wrap ${logColors[entry.level]}`}
              >
                {entry.message}
              </p>
              {entry.response && (
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='h-7 px-0 text-slate-200 hover:bg-transparent hover:text-white'
                    >
                      接口详情
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className='rounded-lg bg-background text-foreground'>
                    <ResponseDetails response={entry.response} />
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
