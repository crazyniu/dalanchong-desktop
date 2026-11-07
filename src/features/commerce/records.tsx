/**
 * AI module map
 * Purpose: expose invitation history, filtering, record details, and manual result review.
 * Entry: RecordsDialog is opened from invitation workspaces or dashboard navigation.
 * Flow: query native pages by platform/account/date/status; fetch responses only when
 * details open. Preview filters its local rows. Export/delete retain the entire scope.
 * Uncertain records are resolved through the store after explicit user confirmation.
 * Details show persisted API responses for either platform regardless of outcome;
 * absent historical responses are labeled, never reconstructed. Talent IDs remain in
 * matching/search/CSV data but are omitted from the details layout.
 * Profile actions use talent-profile.ts and preserve this dialog and running tasks.
 * Douyin uses a record's talentUid or the matching account-scoped collected UID;
 * missing UIDs disable only that profile action, never substitute an encrypted ID.
 * Invariants: review means the platform outcome is unknown, not a failed send eligible
 * for automatic retry. Clearing history changes future deduplication; preserve existing
 * running-task restrictions and explicit-close behavior.
 */

import { useDeferredValue, useMemo, useState } from 'react'
import {
  Download,
  ChevronRight,
  Check,
  X,
  ClipboardList,
  ArrowUpRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/loading-state'
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
import { desktop } from './desktop'
import { useDataQuery, type RecordsPage, type RecordsScope } from './data-query'
import { formatTime, exportRecords } from './format'
import {
  Choice,
  SearchInput,
  ResultBadge,
  Pagination,
} from './shared'
import { useCommerce } from './store'
import { openTalentProfile } from './talent-profile'
import { ResponseDetails } from './response-details'
import { statusNames, platformNames, type InviteRecord } from './types'

export function RecordsDialog({
  open,
  onOpenChange,
  records = emptyRecords,
  scope = {},
  initialStatus = 'all',
}: {
  open: boolean
  onOpenChange: (value: boolean) => void
  records?: InviteRecord[]
  scope?: RecordsScope
  initialStatus?: string
}) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState(initialStatus)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [exporting, setExporting] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolveError, setResolveError] = useState('')
  const [detailId, setDetailId] = useState<string | null>(null)
  const accounts = useCommerce((s) => s.accounts)
  const talents = useCommerce((s) => s.talents)
  const resolve = useCommerce((s) => s.resolveRecord)
  const clearRecords = useCommerce((s) => s.clearRecords)
  const accountNames = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts])
  const talentUids = useMemo(() => {
    const uids = new Map<string, string | undefined>()
    for (const talent of talents) {
      const key = `${talent.platform}:${talent.sourceAccountId}:${talent.id}`
      if (!uids.has(key)) uids.set(key, talent.uid)
    }
    return uids
  }, [talents])
  const deferredQuery = useDeferredValue(query)
  const request = { kind: 'records', ...scope, query: deferredQuery, status }
  const queryResult = useDataQuery<RecordsPage>({ ...request, page, pageSize }, open)
  const detailResult = useDataQuery<InviteRecord | null>({ kind: 'record', id: detailId }, open && Boolean(detailId))
  const filtering = deferredQuery !== query || queryResult.loading
  const searchFields = useMemo(() => records.map((record) => record.name + record.talentId), [records])
  const filtered = useMemo(() => records.filter(
    (r, index) =>
      (status === 'all' || r.status === status) &&
      (!deferredQuery || searchFields[index].includes(deferredQuery))
  ), [records, searchFields, status, deferredQuery])
  const accountIds = useMemo(() => new Set(desktop
    ? accounts.filter((account) =>
      (!scope.platform || scope.platform === 'all' || account.platform === scope.platform) &&
      (!scope.accountId || scope.accountId === 'all' || account.id === scope.accountId)
    ).map((account) => account.id)
    : filtered.map((record) => record.accountId)), [accounts, filtered, scope.platform, scope.accountId])
  const hasRunningTasks = useCommerce((s) => {
    for (const id of accountIds) {
      if (s.tasks[`${id}:collect`]?.status === 'running' ||
          s.tasks[`${id}:invite`]?.status === 'running') return true
    }
    return false
  })
  const detail = desktop ? detailResult.data : records.find((record) => record.id === detailId)
  const total = desktop ? queryResult.data?.total || 0 : filtered.length
  const pages = Math.ceil(total / pageSize)
  const current = desktop ? queryResult.data?.page || page : Math.min(page, Math.max(1, pages))
  const displayed = desktop ? queryResult.data?.rows || [] : filtered.slice((current - 1) * pageSize, current * pageSize)
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
  async function exportCSV() {
    setExporting(true)
    try {
      if (desktop) {
        const { saved, count } = await desktop.exportData(request)
        if (saved) toast.success(`已导出 ${count} 条记录`)
        return
      }
      const saved = await exportRecords(
        filtered.map((r) => ({
          时间: formatTime(r.time),
          平台: platformNames[r.platform],
          账号: accountNames.get(r.accountId) || '已移除账号',
          达人: r.name,
          达人ID: r.talentId,
          状态: statusNames[r.status],
          商品ID: r.products,
          话术: r.message,
          备注: r.note,
        })),
        '邀约记录.csv'
      )
      if (saved) toast.success(`已导出 ${filtered.length} 条记录`)
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
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
              disabled={!total || exporting || filtering}
              onClick={exportCSV}
            >
              <Download />
              {exporting ? '正在导出' : '导出记录'}
            </Button>
            <ClearDataButton
              label='清空记录'
              description={`清空当前筛选范围的 ${total} 条记录，无法恢复；对应的本地邀约去重记录也会移除。`}
              disabled={
                !total || filtering || hasRunningTasks
              }
              onClear={async () => {
                if (desktop) await desktop.deleteData(request)
                else await clearRecords(filtered.map((r) => r.id))
                setDetailId(null)
                setPage(1)
              }}
            />
          </div>
          <div className='min-h-0 flex-1 overflow-y-auto rounded-lg border'>
            {queryResult.loading ? <LoadingState label='正在加载记录' /> : queryResult.error ? (
              <div role='alert' className='grid min-h-40 place-items-center p-6 text-sm text-destructive'>{queryResult.error}</div>
            ) : <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>达人</TableHead>
                  <TableHead>邀约时间</TableHead>
                  <TableHead>结果</TableHead>
                  <TableHead className='w-44' />
                </TableRow>
              </TableHeader>
              <TableBody>
                {displayed.map((r) => {
                  const talentUid = r.talentUid || talentUids.get(`${r.platform}:${r.accountId}:${r.talentId}`)
                  const missingUid = r.platform === 'douyin' && !talentUid
                  return (
                    <TableRow key={r.id}>
                      <TableCell className='font-medium'>{r.name}</TableCell>
                      <TableCell className='text-muted-foreground tabular-nums'>
                        {formatTime(r.time)}
                      </TableCell>
                      <TableCell>
                        <ResultBadge status={r.status} />
                      </TableCell>
                      <TableCell>
                        <div className='flex items-center justify-end gap-1'>
                          <span title={missingUid ? '缺少达人 UID，请重新采集' : undefined}>
                            <Button
                              variant='outline'
                              size='sm'
                              disabled={missingUid}
                              aria-label={`打开${r.name}的达人主页`}
                              onClick={() => void openTalentProfile({
                                platform: r.platform,
                                id: r.talentId,
                                uid: talentUid,
                              })}
                            >
                              <ArrowUpRight />
                              达人主页
                            </Button>
                          </span>
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
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>}
            {!queryResult.loading && !queryResult.error && !total && (
              <div className='grid place-items-center gap-3 py-24 text-muted-foreground'>
                <ClipboardList className='size-8' />
                <span>暂无邀约记录</span>
              </div>
            )}
          </div>
          <Pagination
            page={current}
            pages={pages}
            total={total}
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
        open={Boolean(detailId)}
        onOpenChange={(v) => !v && setDetailId(null)}
      >
        <SheetContent className='overflow-y-auto sm:max-w-[460px]'>
          <SheetHeader>
            <SheetTitle>邀约详情</SheetTitle>
            <SheetDescription className='sr-only'>
              本条邀约的内容和发送结果
            </SheetDescription>
          </SheetHeader>
          {detailResult.loading && <LoadingState label='正在加载详情' />}
          {detailResult.error && <div role='alert' className='p-5 text-sm text-destructive'>{detailResult.error}</div>}
          {desktop && !detailResult.loading && !detailResult.error && !detail && detailId && (
            <div className='grid min-h-40 place-items-center p-5 text-muted-foreground'>记录已不存在</div>
          )}
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
              <section className='min-w-0 space-y-2'>
                <h4 className='font-medium'>接口返回</h4>
                {detail.response ? (
                  <ResponseDetails response={detail.response} />
                ) : (
                  <p className='text-sm text-muted-foreground'>暂无接口返回记录</p>
                )}
              </section>
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

const emptyRecords: InviteRecord[] = []
