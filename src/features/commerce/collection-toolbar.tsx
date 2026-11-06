import {
  ChevronDown,
  History,
  Play,
  RotateCw,
  ScrollText,
  Square,
  UserRound,
} from 'lucide-react'
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Account } from './types'

export type ToolbarAction =
  | { type: 'view'; view: string }
  | { type: 'account'; id: string }
  | {
      type:
        | 'manage'
        | 'reload'
        | 'collect'
        | 'stop'
        | 'return'
        | 'logs'
        | 'records'
        | 'progress'
    }

export type ToolbarState = {
  accountId: string
  accounts: Pick<Account, 'id' | 'name' | 'status'>[]
  view: string
  count: number
  progress: string
  collecting: boolean
  inviting: boolean
  hasInvites: boolean
  pendingInvite: boolean
  returning: boolean
  disabled: boolean
  label: string
}

export function CollectionToolbar({
  state,
  onAction,
}: {
  state: ToolbarState
  onAction: (action: ToolbarAction) => void
}) {
  const account = state.accounts.find((a) => a.id === state.accountId)
  return (
    <div className='collection-toolbar' data-testid='collection-toolbar'>
      <Tabs
        value={state.view}
        onValueChange={(view) => onAction({ type: 'view', view })}
      >
        <TabsList>
          <TabsTrigger value='collect'>采集达人</TabsTrigger>
          <TabsTrigger value='list'>
            采集列表 <span className='ml-1 tabular-nums'>{state.count}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {state.view === 'collect' && (
        <>
          {state.hasInvites && !state.collecting ? (
            <Button
              variant='ghost'
              size='sm'
              onClick={() => onAction({ type: 'progress' })}
            >
              邀约进度
            </Button>
          ) : (
            state.progress && (
              <span
                className='toolbar-progress truncate text-sm text-muted-foreground tabular-nums'
                title={state.progress}
              >
                {state.progress}
              </span>
            )
          )}
          <div className='ml-auto flex min-w-0 items-center gap-2'>
            {account && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant='ghost'
                      size='sm'
                      className='toolbar-account min-w-0 gap-2 text-muted-foreground'
                      aria-label='当前网页账号'
                    >
                      <UserRound className='size-4' />
                      <span className='truncate'>{account.name}</span>
                      <span
                        className={`size-1.5 shrink-0 rounded-full ${account.status === 'online' ? 'bg-emerald-600' : 'bg-amber-600'}`}
                      />
                      <ChevronDown className='size-3' />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align='end'
                    side='top'
                    avoidCollisions={false}
                    className='max-h-72 overflow-y-auto'
                  >
                    <DropdownMenuLabel>网页账号</DropdownMenuLabel>
                    {state.accounts.map((a) => (
                      <DropdownMenuItem
                        key={a.id}
                        onClick={() => onAction({ type: 'account', id: a.id })}
                      >
                        <span className='max-w-56 truncate'>{a.name}</span>
                        {a.id === account.id && (
                          <Badge variant='secondary' className='ml-auto'>
                            当前
                          </Badge>
                        )}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => onAction({ type: 'manage' })}
                    >
                      管理账号
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8 shrink-0'
                  aria-label='返回达人页面'
                  title='返回达人页面'
                  disabled={state.collecting || state.inviting}
                  onClick={() => onAction({ type: 'reload' })}
                >
                  <RotateCw className='size-4' />
                </Button>
              </>
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
              account && (
                <Button
                  size='sm'
                  disabled={state.disabled}
                  onClick={() =>
                    onAction({
                      type:
                        state.collecting || state.inviting ? 'stop' : 'collect',
                    })
                  }
                >
                  {state.collecting || state.inviting ? (
                    <Square className='size-3 fill-current' />
                  ) : (
                    <Play className='size-3 fill-current' />
                  )}
                  {state.label}
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
