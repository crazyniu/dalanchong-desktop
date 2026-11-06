import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Plus,
  MoreHorizontal,
  ArrowUpRight,
  LogIn,
  Trash2,
  ShieldCheck,
  ScrollText,
  Store,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { desktop } from './desktop'
import { formatTime } from './format'
import { Choice, SearchInput, PlatformBadge, NameAvatar } from './shared'
import { useCommerce } from './store'
import { TaskLogsDialog } from './task-logs'
import type { Platform, Account } from './types'

export function AccountsPage() {
  const store = useCommerce()
  const navigate = useNavigate()
  const [platform, setPlatform] = useState('all')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [newPlatform, setNewPlatform] = useState<Platform>('kuaishou')
  const [name, setName] = useState('')
  const [loginId, setLoginId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const filtered = store.accounts.filter(
    (a) =>
      (platform === 'all' || a.platform === platform) &&
      (a.name + a.shopId).includes(query)
  )
  const loggingIn = store.accounts.find((a) => a.id === loginId)
  function openAccount(a: Account) {
    store.selectAccount(a.platform, a.id)
    navigate({ to: a.platform === 'kuaishou' ? '/kuaishou' : '/douyin' })
  }
  return (
    <main className='page-content space-y-5'>
      <div className='page-toolbar flex-wrap'>
        <Tabs value={platform} onValueChange={setPlatform}>
          <TabsList>
            <TabsTrigger value='all'>
              全部账号{' '}
              <span className='ml-1.5 text-muted-foreground'>
                {store.accounts.length}
              </span>
            </TabsTrigger>
            <TabsTrigger value='kuaishou'>快手</TabsTrigger>
            <TabsTrigger value='douyin'>抖音</TabsTrigger>
          </TabsList>
        </Tabs>
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder='搜索店铺或账号'
          className='ml-auto w-60'
        />
        <Button variant='outline' onClick={() => setLogsOpen(true)}>
          <ScrollText />
          错误日志
        </Button>
        <Button
          onClick={() => {
            setNewPlatform(platform === 'douyin' ? 'douyin' : 'kuaishou')
            setName('')
            setAdding(true)
          }}
        >
          <Plus />
          添加账号
        </Button>
      </div>
      <div className='overflow-hidden rounded-xl border bg-white'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='pl-6'>店铺账号</TableHead>
              <TableHead>平台</TableHead>
              <TableHead>登录状态</TableHead>
              <TableHead>登录保存时间</TableHead>
              <TableHead>剩余额度</TableHead>
              <TableHead className='w-32' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a, i) => (
              <TableRow key={a.id} className='h-24'>
                <TableCell className='pl-6'>
                  <div className='flex items-center gap-3'>
                    <NameAvatar name={a.name} index={i} />
                    <div className='space-y-1.5'>
                      <div className='font-medium'>{a.name}</div>
                      <div className='text-sm text-muted-foreground'>
                        {a.shopId}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <PlatformBadge platform={a.platform} />
                </TableCell>
                <TableCell>
                  <Badge
                    variant='outline'
                    className={`gap-1.5 border-0 font-normal ${a.status === 'online' ? 'bg-emerald-50 text-emerald-700' : a.status === 'expired' ? 'bg-amber-50 text-amber-800' : 'bg-muted text-muted-foreground'}`}
                  >
                    <span className='size-1.5 rounded-full bg-current' />
                    {a.status === 'online'
                      ? '已登录'
                      : a.status === 'expired'
                        ? '登录已失效'
                        : '未登录'}
                  </Badge>
                </TableCell>
                <TableCell className='text-muted-foreground tabular-nums'>
                  {a.savedAt ? formatTime(a.savedAt) : '—'}
                </TableCell>
                <TableCell>
                  <span className='tabular-nums'>
                    {a.quotaError ? '—' : a.quota}
                  </span>
                  <span className='ml-2 text-muted-foreground'>
                    {a.platform === 'kuaishou' ? '今日' : '本周'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className='flex items-center gap-1'>
                    <Button
                      size='sm'
                      variant={a.status === 'online' ? 'outline' : 'secondary'}
                      onClick={() =>
                        a.status === 'online' || desktop
                          ? openAccount(a)
                          : setLoginId(a.id)
                      }
                    >
                      {a.status === 'online' ? '打开' : '登录'}
                      {a.status === 'online' ? <ArrowUpRight /> : <LogIn />}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label={`${a.name}的操作`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end'>
                        <DropdownMenuItem
                          onClick={() =>
                            desktop ? openAccount(a) : setLoginId(a.id)
                          }
                        >
                          <LogIn />
                          重新登录
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => setRemoveId(a.id)}
                          disabled={store.tasks[a.id]?.status === 'running'}
                        >
                          <Trash2 />
                          移除账号
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!filtered.length && (
          <div className='grid place-items-center gap-3 py-28 text-muted-foreground'>
            <Store className='size-9' />
            <p>暂无符合条件的账号</p>
          </div>
        )}
      </div>
      <div className='flex items-center gap-2 text-sm text-muted-foreground'>
        <ShieldCheck size={16} />
        <span>登录数据按账号保存在本机</span>
      </div>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader className='sm:text-center'>
            <DialogTitle>添加平台账号</DialogTitle>
            <DialogDescription className='sr-only'>
              选择平台并为账号命名
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const id = store.addAccount(newPlatform, name.trim())
              setAdding(false)
              if (desktop)
                openAccount(
                  useCommerce.getState().accounts.find((a) => a.id === id)!
                )
              else setLoginId(id)
            }}
            className='space-y-5'
          >
            <div className='space-y-2'>
              <Label htmlFor='new-platform'>平台</Label>
              <Choice
                label='新账号平台'
                value={newPlatform}
                onChange={(v) => setNewPlatform(v as Platform)}
                options={[
                  { value: 'kuaishou', label: '快手' },
                  { value: 'douyin', label: '抖音' },
                ]}
                className='w-full'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='account-name'>账号名称</Label>
              <Input
                id='account-name'
                placeholder='输入店铺名称'
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type='button'
                variant='outline'
                onClick={() => setAdding(false)}
              >
                取消
              </Button>
              <Button type='submit' disabled={!name.trim()}>
                添加并登录
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(loggingIn)}
        onOpenChange={(v) => !v && setLoginId(null)}
      >
        <DialogContent className='sm:max-w-[400px]'>
          <DialogHeader>
            <DialogTitle>账号登录</DialogTitle>
            <DialogDescription className='sr-only'>
              演示账号登录流程
            </DialogDescription>
          </DialogHeader>
          {loggingIn && (
            <div className='flex flex-col items-center gap-6 py-6'>
              <span className='flex size-16 items-center justify-center rounded-2xl bg-muted'>
                <Store className='size-7' />
              </span>
              <div className='flex flex-col items-center gap-3'>
                <h3 className='text-lg font-semibold'>{loggingIn.name}</h3>
                <PlatformBadge platform={loggingIn.platform} />
              </div>
              <Badge variant='outline'>演示登录</Badge>
              <Button
                className='w-full'
                onClick={() => {
                  store.login(loggingIn.id)
                  setLoginId(null)
                  toast.success('演示登录成功，账号状态已更新')
                }}
              >
                模拟登录成功
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={Boolean(removeId)}
        onOpenChange={(v) => !v && setRemoveId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除这个账号？</AlertDialogTitle>
            <AlertDialogDescription>
              该账号的登录数据将清除，历史邀约记录保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                store
                  .removeAccount(removeId!)
                  .then(() => {
                    setRemoveId(null)
                    toast.success('账号已移除')
                  })
                  .catch((e) => toast.error(e.message))
              }}
            >
              移除账号
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {logsOpen && (
        <TaskLogsDialog
          open
          onOpenChange={setLogsOpen}
          initialPlatform={platform as Platform | 'all'}
        />
      )}
    </main>
  )
}
