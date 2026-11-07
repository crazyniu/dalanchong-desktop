/**
 * AI module map
 * Purpose: present the invitation workspace's bottom floating controls.
 * Entry: CollectionToolbar consumes ToolbarState and emits the ToolbarAction union.
 * Flow: labels/disabled states reflect parent snapshots; clicks request view, platform home/history,
 * collection, collection stop, logs, or records actions through the owner. The grip owns
 * pointer capture and reports screen-coordinate deltas; the parent owns positioning.
 * Invariant: this reusable view never invokes native business commands itself; it is
 * rendered both in the main preview and in toolbar-overlay.tsx's separate WebView.
 */

import { useRef, useState, type PointerEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  History,
  House,
  Play,
  ScrollText,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ToolbarAction =
  | { type: 'view'; view: string }
  | {
      type:
        | 'home'
        | 'back'
        | 'forward'
        | 'collect'
        | 'stop'
        | 'return'
        | 'logs'
        | 'records'
    }

export type ToolbarState = {
  kind?: 'invite'
  accountId: string
  view: string
  count: number
  collecting: boolean
  inviting: boolean
  pendingInvite: boolean
  returning: boolean
  disabled: boolean
  navigationDisabled: boolean
  label: string
}

export function CollectionToolbar({
  state,
  onAction,
  onMove,
}: {
  state: ToolbarState
  onAction: (action: ToolbarAction) => void
  onMove: (deltaX: number, deltaY: number) => void
}) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const previous = pointer.current
    if (!previous || previous.id !== event.pointerId) return
    // Client coordinates move with the native child; screen coordinates stay stable.
    const deltaX = event.screenX - previous.x
    const deltaY = event.screenY - previous.y
    pointer.current = { id: event.pointerId, x: event.screenX, y: event.screenY }
    if (deltaX || deltaY) onMove(deltaX, deltaY)
  }
  const endDrag = () => {
    pointer.current = null
    setDragging(false)
  }
  return (
    <div className='collection-toolbar' data-testid='collection-toolbar'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='toolbar-drag-handle size-8 text-muted-foreground'
        aria-label='拖动工具栏'
        title='拖动工具栏'
        data-dragging={dragging}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = { id: event.pointerId, x: event.screenX, y: event.screenY }
          setDragging(true)
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (pointer.current?.id !== event.pointerId) return
          move(event)
          event.currentTarget.releasePointerCapture(event.pointerId)
          endDrag()
        }}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripVertical className='size-5' />
      </Button>
      <Tabs
        value={state.view}
        onValueChange={(view) => onAction({ type: 'view', view })}
      >
        <TabsList>
          <TabsTrigger value='collect'>采集达人</TabsTrigger>
          <TabsTrigger value='list'>
            邀约达人 <span className='ml-1 tabular-nums'>{state.count}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {state.view === 'collect' && (
        <div className='ml-auto flex min-w-0 items-center gap-2'>
          {state.accountId && (
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label='后退'
                title='后退'
                disabled={state.navigationDisabled}
                onClick={() => onAction({ type: 'back' })}
              >
                <ArrowLeft className='size-4' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                className='size-8'
                aria-label='前进'
                title='前进'
                disabled={state.navigationDisabled}
                onClick={() => onAction({ type: 'forward' })}
              >
                <ArrowRight className='size-4' />
              </Button>
              <Button
                variant='ghost'
                size='sm'
                className='shrink-0'
                aria-label='主页'
                title='主页'
                disabled={state.collecting || state.inviting}
                onClick={() => onAction({ type: 'home' })}
              >
                <House className='size-4' />
                主页
              </Button>
            </div>
          )}
          {state.pendingInvite ? (
            <Button
              size='sm'
              disabled={state.returning}
              onClick={() => onAction({ type: 'return' })}
            >
              {state.returning ? '正在打开' : '返回邀约'}
            </Button>
          ) : (
            state.accountId && (
              <Button
                size='sm'
                disabled={state.disabled}
                onClick={() =>
                  onAction({
                    type: state.collecting ? 'stop' : 'collect',
                  })
                }
              >
                {state.collecting ? (
                  <Square className='size-3 fill-current' />
                ) : (
                  <Play className='size-3 fill-current' />
                )}
                {state.label}
              </Button>
            )
          )}
        </div>
      )}
      <Button
        variant='ghost'
        size='sm'
        className={
          state.view === 'list'
            ? 'ml-auto text-muted-foreground'
            : 'text-muted-foreground'
        }
        onClick={() => onAction({ type: 'logs' })}
        aria-label='错误日志'
        title='错误日志'
      >
        <ScrollText />
        <span className='toolbar-secondary-label'>错误日志</span>
      </Button>
      <Button
        variant='ghost'
        size='sm'
        className='text-muted-foreground'
        onClick={() => onAction({ type: 'records' })}
        aria-label='邀约记录'
        title='邀约记录'
      >
        <History />
        <span className='toolbar-secondary-label'>邀约记录</span>
      </Button>
    </div>
  )
}
