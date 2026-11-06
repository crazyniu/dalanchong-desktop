import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Minus, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { ResponseDetails } from './task-logs'
import type { Task } from './types'

export function CollectionLog({ task }: { task: Task }) {
  const [collapsed, setCollapsed] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const logs = (task.logs || []).filter((entry) => entry.level === 'error')
  const latest = logs[logs.length - 1]
  useEffect(() => {
    if (viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight
  }, [latest, collapsed])

  if (!logs.length) return null
  if (collapsed)
    return (
      <Button
        variant='secondary'
        className='absolute right-4 bottom-4 z-30 border border-white/15 bg-slate-950/75 text-white shadow-lg backdrop-blur-md hover:bg-slate-900/85'
        onClick={() => setCollapsed(false)}
      >
        <ScrollText />
        采集错误 · {logs.length}
      </Button>
    )

  return (
    <Card
      className='absolute right-4 bottom-4 z-30 w-[440px] max-w-[calc(100%_-_32px)] gap-0 overflow-hidden border-white/15 bg-slate-950/75 py-0 text-white shadow-xl backdrop-blur-md'
      data-testid='collection-log'
    >
      <CardHeader className='flex flex-row items-center gap-3 border-b border-white/15 px-4 py-3'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          {task.status === 'running' ? (
            <LoaderCircle className='size-4 animate-spin' />
          ) : (
            <ScrollText className='size-4' />
          )}
          采集错误
        </CardTitle>
        <span className='ml-auto text-sm text-slate-200 tabular-nums'>
          {logs.length} 条错误
        </span>
        <Button
          variant='ghost'
          size='icon'
          className='size-7 text-slate-200 hover:bg-white/10 hover:text-white'
          aria-label='收起采集错误'
          onClick={() => setCollapsed(true)}
        >
          <Minus />
        </Button>
      </CardHeader>
      <CardContent
        ref={viewport}
        role='log'
        aria-label='采集错误'
        aria-live='polite'
        className='max-h-60 space-y-2 overflow-y-auto px-4 py-3 text-sm leading-6'
      >
        {logs.map((entry, index) => (
          <div
            key={`${entry.time}-${index}`}
            className='flex items-start gap-3'
          >
            <time
              className='shrink-0 text-slate-300 tabular-nums'
              dateTime={entry.time}
            >
              {new Date(entry.time).toLocaleTimeString('zh-CN', {
                hour12: false,
              })}
            </time>
            <div className='min-w-0 flex-1'>
              <p className='break-words text-red-300'>{entry.message}</p>
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
