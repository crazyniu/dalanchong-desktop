import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Download, ScrollText } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { desktop } from './desktop'
import { exportRecords } from './format'
import { Choice, Pagination } from './shared'
import { useCommerce } from './store'
import { platformNames, type DiagnosticResponse, type Platform } from './types'

export function ResponseDetails({
  response,
}: {
  response: DiagnosticResponse
}) {
  return (
    <div className='space-y-3 rounded-lg border bg-muted/30 p-3 text-sm'>
      <div className='flex flex-wrap items-center gap-2'>
        {response.method && <Badge variant='outline'>{response.method}</Badge>}
        <code className='min-w-0 break-all'>{response.path}</code>
        {response.status !== undefined && (
          <Badge variant='secondary'>HTTP {response.status}</Badge>
        )}
        {response.code !== undefined && <span>错误码 {response.code}</span>}
      </div>
      {response.message && (
        <p className='break-words whitespace-pre-wrap'>{response.message}</p>
      )}
      {response.requestId && (
        <p className='break-all text-muted-foreground'>
          请求 ID：{response.requestId}
        </p>
      )}
      {response.body !== undefined && (
        <pre className='max-h-52 overflow-auto rounded-md bg-background p-3 font-mono text-xs leading-5 break-all whitespace-pre-wrap'>
          {typeof response.body === 'string'
            ? response.body
            : JSON.stringify(response.body, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function TaskLogsDialog({
  open,
  onOpenChange,
  initialPlatform = 'all',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialPlatform?: Platform | 'all'
}) {
  const logs = useCommerce((s) => s.logs) ?? []
  const accounts = useCommerce((s) => s.accounts)
  const [platform, setPlatform] = useState<string>(initialPlatform)
  const [accountId, setAccountId] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const filtered = logs
    .filter(
      (log) =>
        log.level === 'error' &&
        (platform === 'all' || !log.platform || log.platform === platform) &&
        (accountId === 'all' || log.accountId === accountId)
    )
    .reverse()
  const pages = Math.ceil(filtered.length / 20)
  const current = Math.min(page, Math.max(1, pages))
  async function exportLogs() {
    setExporting(true)
    try {
      if (desktop) {
        if (await desktop.exportLogs()) toast.success('错误日志已导出')
      } else {
        exportRecords(
          filtered.map((log) => ({
            时间: log.time,
            平台: log.platform ? platformNames[log.platform] : '应用',
            账号:
              accounts.find((a) => a.id === log.accountId)?.name ||
              log.accountId ||
              '',
            类型:
              log.kind === 'collect'
                ? '采集'
                : log.kind === 'invite'
                  ? '邀约'
                  : '应用',
            内容: log.message,
            接口详情: log.response ? JSON.stringify(log.response) : '',
          })),
          '错误日志.csv'
        )
        toast.success('错误日志已导出')
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
          <Choice
            label='日志平台'
            value={platform}
            onChange={(value) => {
              setPlatform(value)
              setAccountId('all')
              setPage(1)
            }}
            options={[
              { value: 'all', label: '全部平台' },
              ...Object.entries(platformNames).map(([value, label]) => ({
                value,
                label,
              })),
            ]}
          />
          <Choice
            label='日志账号'
            value={accountId}
            onChange={(value) => {
              setAccountId(value)
              setPage(1)
            }}
            options={[
              { value: 'all', label: '全部账号' },
              ...accounts
                .filter((a) => platform === 'all' || a.platform === platform)
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <Button
            variant='outline'
            className='ml-auto'
            disabled={exporting || (!desktop && !filtered.length)}
            onClick={exportLogs}
          >
            <Download />
            {exporting ? '正在导出' : '导出日志'}
          </Button>
        </div>
        <div className='min-h-0 flex-1 overflow-y-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-40'>时间</TableHead>
                <TableHead className='w-40'>账号</TableHead>
                <TableHead className='w-20'>类型</TableHead>
                <TableHead>内容</TableHead>
                <TableHead className='w-12' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice((current - 1) * 20, current * 20).map((log) => (
                <Fragment key={log.id}>
                  <TableRow className='align-top'>
                    <TableCell className='whitespace-nowrap text-muted-foreground tabular-nums'>
                      {new Date(log.time).toLocaleString('zh-CN', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        hour12: false,
                      })}
                    </TableCell>
                    <TableCell>
                      <div className='max-w-40 break-words'>
                        {accounts.find((a) => a.id === log.accountId)?.name ||
                          log.accountId ||
                          '应用'}
                      </div>
                      {log.platform && (
                        <div className='mt-1 text-muted-foreground'>
                          {platformNames[log.platform]}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.kind === 'collect'
                        ? '采集'
                        : log.kind === 'invite'
                          ? '邀约'
                          : '应用'}
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
                      <TableCell colSpan={5}>
                        <ResponseDetails response={log.response} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          {!filtered.length && (
            <div className='grid justify-items-center gap-3 py-20 text-muted-foreground'>
              <ScrollText className='size-8' />
              <span>暂无错误</span>
            </div>
          )}
        </div>
        <Pagination
          page={current}
          pages={pages}
          total={filtered.length}
          onChange={setPage}
        />
      </DialogContent>
    </Dialog>
  )
}
