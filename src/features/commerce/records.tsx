import { useState } from 'react'
import { Download, ChevronRight, Check, X, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ClearDataButton } from './clear-data-button'
import { formatTime, exportRecords } from './format'
import {
  Choice,
  SearchInput,
  ResultBadge,
  PlatformBadge,
  Pagination,
} from './shared'
import { useCommerce } from './store'
import { ResponseDetails } from './task-logs'
import { statusNames, platformNames, type InviteRecord } from './types'

export function RecordsDialog({
  open,
  onOpenChange,
  records,
  initialStatus = 'all',
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  records: InviteRecord[]
  initialStatus?: string
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const accounts = useCommerce((s) => s.accounts)
  const resolve = useCommerce((s) => s.resolveRecord)
  const clearRecords = useCommerce((s) => s.clearRecords)
  const tasks = useCommerce((s) => s.tasks)
  const filtered = records.filter(
    (r) =>
      (status === 'all' || r.status === status) &&
      (r.name + r.talentId).includes(query)
  )
  const detail = records.find((r) => r.id === detailId)
  const pages = Math.ceil(filtered.length / pageSize)
  const current = Math.min(page, Math.max(1, pages))
  const displayed = filtered.slice((current - 1) * pageSize, current * pageSize)
  async function confirmResult(id: string, sent: boolean) {
    setResolving(true)
    setResolveError('')
    try {
      await resolve(id, sent)
      toast.success(sent ? '已确认邀约成功' : '已确认未邀约')
    } catch (e) {
      setResolveError((e as Error).message)
    } finally {
      setResolving(false)
    }
  }
  function exportCSV() {
    exportRecords(
      filtered.map((r) => ({
        时间: formatTime(r.time),
        平台: platformNames[r.platform],
        账号: accounts.find((a) => a.id === r.accountId)?.name || '已移除账号',
        达人: r.name,
        达人ID: r.talentId,
        状态: statusNames[r.status],
        商品ID: r.products,
        话术: r.message,
        备注: r.note,
      })),
      '邀约记录.csv'
    )
    toast.success(`已导出 ${filtered.length} 条记录`)
  }
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='flex max-h-[85vh] flex-col gap-5 sm:max-w-[1000px]'>
          <DialogHeader>
            <DialogTitle>邀约记录</DialogTitle>
            <DialogDescription className='sr-only'>
              查看、导出及核实邀约结果
            </DialogDescription>
          </DialogHeader>
          <div className='flex flex-wrap items-center gap-3'>
            <SearchInput
              value={query}
              onChange={(v) => {
                setQuery(v)
                setPage(1)
              }}
              className='w-60'
            />
            <Choice
              value={status}
              onChange={(v) => {
                setStatus(v)
                setPage(1)
              }}
              label='邀约状态'
              options={[
                { value: 'all', label: '全部状态' },
                ...Object.entries(statusNames).map(([value, label]) => ({
                  value,
                  label,
                })),
              ]}
            />
            <Button
              variant='outline'
              className='ml-auto'
              disabled={!filtered.length}
              onClick={exportCSV}
            >
              <Download />
              导出记录
            </Button>
            <ClearDataButton
              label='清空记录'
              description={`清空当前筛选范围的 ${filtered.length} 条记录，无法恢复；对应的本地邀约去重记录也会移除。`}
              disabled={
                !filtered.length ||
                filtered.some((r) => tasks[r.accountId]?.status === 'running')
              }
              onClear={async () => {
                await clearRecords(filtered.map((r) => r.id))
                setDetailId(null)
                setPage(1)
              }}
            />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>达人</TableHead>
                  <TableHead>平台 / 账号</TableHead>
                  <TableHead>邀约时间</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead className='w-16' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className='font-medium'>{r.name}</TableCell>
                    <TableCell>
                      <span className='flex items-center gap-2'>
                        <PlatformBadge platform={r.platform} compact />
                        {accounts.find((a) => a.id === r.accountId)?.name ||
                          '已移除账号'}
                      </span>
                    </TableCell>
                    <TableCell className='text-muted-foreground tabular-nums'>
                      {formatTime(r.time)}
                    </TableCell>
                    <TableCell>
                      <ResultBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='icon'
                        aria-label={`查看${r.name}的记录`}
                        onClick={() => {
                          setDetailId(r.id)
                          setResolveError('')
                        }}
                      >
                        <ChevronRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {!filtered.length && (
              <div className='grid place-items-center gap-3 py-24 text-muted-foreground'>
                <ClipboardList className='size-8' />
                <span>暂无邀约记录</span>
              </div>
            )}
          </div>
          <Pagination
            page={current}
            pages={pages}
            total={filtered.length}
            pageSize={pageSize}
            onChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(1)
            }}
          />
        </DialogContent>
      </Dialog>
      <Sheet
        open={Boolean(detail)}
        onOpenChange={(v) => !v && setDetailId(null)}
      >
        <SheetContent className='overflow-y-auto sm:max-w-[460px]'>
          <SheetHeader>
            <SheetTitle>邀约详情</SheetTitle>
            <SheetDescription className='sr-only'>
              本条邀约的内容和发送结果
            </SheetDescription>
          </SheetHeader>
          {detail && (
            <div className='space-y-6 px-5 pb-6'>
              <div className='flex items-center justify-between'>
                <h3 className='text-lg font-semibold'>{detail.name}</h3>
                <ResultBadge status={detail.status} />
              </div>
              <dl className='detail-list'>
                <dt>发送账号</dt>
                <dd>
                  {accounts.find((a) => a.id === detail.accountId)?.name ||
                    '已移除账号'}
                </dd>
                <dt>达人 ID</dt>
                <dd>{detail.talentId}</dd>
                <dt>发送时间</dt>
                <dd>{formatTime(detail.time)}</dd>
                <dt>来源</dt>
                <dd>{detail.source}</dd>
              </dl>
              <Separator />
              <div className='space-y-2'>
                <h4 className='font-medium'>商品 ID</h4>
                <p className='break-all text-muted-foreground'>
                  {detail.products}
                </p>
              </div>
              <div className='space-y-2'>
                <h4 className='font-medium'>邀约话术</h4>
                <p className='rounded-lg bg-muted/60 p-4 leading-7 break-words whitespace-pre-wrap'>
                  {detail.message}
                </p>
              </div>
              {detail.note && (
                <p className='rounded-lg bg-amber-50 p-4 leading-6 text-amber-900'>
                  {detail.note}
                </p>
              )}
              {detail.response && (
                <ResponseDetails response={detail.response} />
              )}
              {resolveError && (
                <p role='alert' className='text-sm text-red-600'>
                  {resolveError}
                </p>
              )}
              {detail.status === 'review' && (
                <div className='flex gap-2'>
                  <Button
                    disabled={resolving}
                    onClick={() => confirmResult(detail.id, true)}
                  >
                    <Check />
                    确认已邀约
                  </Button>
                  <Button
                    variant='outline'
                    disabled={resolving}
                    onClick={() => confirmResult(detail.id, false)}
                  >
                    <X />
                    确认未邀约
                  </Button>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  )
}
