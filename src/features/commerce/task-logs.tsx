/**
 * AI module map
 * Purpose: browse, expand, export, and explicitly clear persisted error diagnostics.
 * Entry: TaskLogsDialog receives a fixed account; response-details.tsx owns the shared
 * sanitized response presentation without importing the commerce runtime.
 * Flow: query a database page for the fixed account, export its history, and clear
 * through the account-scoped action. Browser preview retains its local array.
 * Invariants: the log list shows errors only; invitation details also show successful
 * responses. Never reconstruct credentials, raw request headers, or missing responses.
 * Native pages and exports cover the account's complete retained history.
 */

import { Fragment, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/loading-state'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useDataQuery, type LogsPage } from './data-query'
import { exportRecords, formatLogTime } from './format'
import { Pagination } from './shared'
import { useCommerce } from './store'
import { ResponseDetails } from './response-details'
import type { Platform } from './types'

export function TaskLogsDialog({
  open,
  onOpenChange,
  platform,
  accountId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  platform: Platform
  accountId: string
}) {
  const logs = useCommerce((s) => s.logs) ?? []
  const clearLogs = useCommerce((s) => s.clearLogs)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [exporting, setExporting] = useState(false)
  const filtered = useMemo(() => logs
    .filter(
      (log) =>
        log.level === 'error' &&
        (!log.platform || log.platform === platform) &&
        log.accountId === accountId
    )
    .reverse(), [logs, platform, accountId])
  const request = { kind: 'logs', platform, accountId }
  const queryResult = useDataQuery<LogsPage>({ ...request, page, pageSize }, open)
  const total = desktop ? queryResult.data?.total || 0 : filtered.length
  const pages = Math.ceil(total / pageSize)
  const current = desktop ? queryResult.data?.page || page : Math.min(page, Math.max(1, pages))
  const displayed = desktop ? queryResult.data?.rows || [] : filtered.slice((current - 1) * pageSize, current * pageSize)
  async function exportLogs() {
    setExporting(true)
    try {
      if (desktop) {
        const { saved } = await desktop.exportData(request)
        if (saved) toast.success('错误日志已导出')
      } else {
        const saved = await exportRecords(
          filtered.map((log) => ({
            时间: log.time,
            内容: log.message,
            接口详情: log.response ? JSON.stringify(log.response) : '',
          })),
          '错误日志.csv'
        )
        if (saved) toast.success('错误日志已导出')
      }
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setExporting(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='flex max-h-[85vh] flex-col gap-4 sm:max-w-[1080px]'>
        <DialogHeader>
          <DialogTitle>错误日志</DialogTitle>
          <DialogDescription className='sr-only'>
            查看采集、邀约与网页错误日志
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-wrap items-center gap-3'>
          <Button
            variant='outline'
            className='ml-auto'
            disabled={exporting || !total || queryResult.loading}
            onClick={exportLogs}
          >
            <Download />
            {exporting ? '正在导出' : '导出日志'}
          </Button>
          <ClearDataButton
            label='清空日志'
            description='清空当前账号的全部错误日志，无法恢复。'
            disabled={!total || queryResult.loading}
            onClear={async () => {
              if (desktop) await desktop.deleteData(request)
              else await clearLogs(platform, accountId)
              setExpanded(null)
              setPage(1)
            }}
          />
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto rounded-lg border'>
          {queryResult.loading ? <LoadingState label='正在加载日志' /> : queryResult.error ? (
            <div role='alert' className='grid min-h-40 place-items-center p-6 text-sm text-destructive'>{queryResult.error}</div>
          ) : <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-40'>时间</TableHead>
                <TableHead>内容</TableHead>
                <TableHead className='w-12' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayed.map((log) => (
                <Fragment key={log.id}>
                  <TableRow className='align-top'>
                    <TableCell className='whitespace-nowrap text-muted-foreground tabular-nums'>
                      {formatLogTime(log.time)}
                    </TableCell>
                    <TableCell className='max-w-lg min-w-0 break-all whitespace-pre-wrap'>
                      {log.message}
                    </TableCell>
                    <TableCell>
                      {log.response && (
                        <Button
                          variant='ghost'
                          size='icon'
                          className='size-7'
                          aria-label='展开接口详情'
                          aria-expanded={expanded === log.id}
                          onClick={() =>
                            setExpanded(expanded === log.id ? null : log.id)
                          }
                        >
                          {expanded === log.id ? (
                            <ChevronDown />
                          ) : (
                            <ChevronRight />
                          )}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                  {expanded === log.id && log.response && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <ResponseDetails response={log.response} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>}
          {!queryResult.loading && !queryResult.error && !total && (
            <div className='grid justify-items-center gap-3 py-20 text-muted-foreground'>
              <ScrollText className='size-8' />
              <span>暂无错误</span>
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
  )
}
