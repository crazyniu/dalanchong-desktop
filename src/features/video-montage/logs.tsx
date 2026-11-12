/**
 * AI module map
 * Purpose: show native montage activity in the collection terminal's floating dark card.
 * Entry: page.tsx controls expansion; a newly running batch expands the card automatically.
 * Flow: native snapshots supply bounded logs and completed/planned output counts.
 * State: scrolling up suspends following; collapse/reopen retains the reading position.
 * Invariants: this nonmodal view never changes execution, clears logs, or fabricates progress.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { LoaderCircle, Minus, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { MontageSnapshot } from './types'

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
})

export function MontageLog({ open, snapshot, onOpenChange }: {
  open: boolean
  snapshot: MontageSnapshot
  onOpenChange: (open: boolean) => void
}) {
  const viewport = useRef<HTMLDivElement>(null)
  const followBottom = useRef(true)
  const scrollPosition = useRef(0)
  const { logs, running, rows } = snapshot
  const newestId = logs[logs.length - 1]?.id
  const completed = rows.reduce((count, row) => count + row.completed, 0)
  const total = rows.reduce((count, row) => count + row.total, 0)

  useEffect(() => {
    if (running) {
      followBottom.current = true
      scrollPosition.current = 0
      onOpenChange(true)
      if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight
    }
  }, [running, onOpenChange])

  useLayoutEffect(() => {
    if (open && viewport.current) {
      viewport.current.scrollTop = followBottom.current
        ? viewport.current.scrollHeight
        : scrollPosition.current
    }
  }, [open, newestId])

  if (!open) {
    if (!running && logs.length === 0) return null
    return (
      <Button
        type='button'
        variant='secondary'
        className='dark absolute right-4 bottom-4 z-30 max-w-[calc(100%_-_32px)] border border-border bg-background/75 text-foreground shadow-lg backdrop-blur-md hover:bg-background/85'
        aria-label='展开处理日志'
        onClick={() => onOpenChange(true)}
      >
        <ScrollText />
        处理日志 · 已完成 {completed}/{total}
      </Button>
    )
  }

  return (
    <Card className='dark absolute right-4 bottom-4 z-30 max-h-[calc(100%_-_32px)] w-[440px] max-w-[calc(100%_-_32px)] gap-0 overflow-hidden border-border bg-background/75 py-0 text-foreground shadow-xl backdrop-blur-md'>
      <CardHeader className='flex shrink-0 flex-row items-center gap-3 border-b border-border px-3 py-3'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          {running ? <LoaderCircle className='size-4 motion-safe:animate-spin' /> : <ScrollText className='size-4' />}
          处理日志
        </CardTitle>
        <span className='ml-auto text-sm text-muted-foreground tabular-nums'>已完成 {completed}/{total}</span>
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='size-7 text-slate-200 hover:bg-white/10 hover:text-white'
          aria-label='收起处理日志'
          onClick={() => onOpenChange(false)}
        ><Minus /></Button>
      </CardHeader>
      <CardContent
        ref={viewport}
        role='log'
        aria-label='视频混剪处理日志'
        aria-live='polite'
        aria-relevant='additions'
        tabIndex={0}
        className='max-h-[360px] min-h-0 space-y-1 overflow-y-auto overscroll-contain px-3 py-3 font-mono text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring'
        onScroll={(event) => {
          const element = event.currentTarget
          scrollPosition.current = element.scrollTop
          followBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 12
        }}
      >
        {logs.length === 0 ? <p className='text-muted-foreground'>暂无日志</p> : logs.map((entry) => (
          <div key={entry.id} className='flex items-start gap-2'>
            <time className='shrink-0 text-muted-foreground tabular-nums' dateTime={new Date(entry.timestamp).toISOString()}>
              {timeFormat.format(entry.timestamp)}
            </time>
            <p className={cn('min-w-0 flex-1 whitespace-pre-wrap wrap-anywhere text-slate-200', {
              'text-red-300': entry.level === 'error',
              'text-emerald-300': entry.level === 'success',
            })} title={entry.sourcePath || undefined}>
              {entry.videoName && `${entry.videoName} · `}{entry.message}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
