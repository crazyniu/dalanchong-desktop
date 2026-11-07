/**
 * AI module map
 * Purpose: aggregate persisted commerce activity into filterable summary cards and charts.
 * Entry: Dashboard is the default route; native queries supply database aggregates.
 * useCommerce supplies accounts and browser-preview data; charts render bounded summaries.
 * Flow: platform/account/date filters drive totals, trend/distribution charts,
 * and CSV exports through format.ts. Summary metrics and distribution labels open
 * filtered records; AccountQuota displays dated platform balances independently
 * of the historical date filter and hides invalidated or expired observations.
 * Invariant: counters are derived from stored result states, not independent business
 * state; displaying remaining quota must not imply a new authenticated quota check.
 * Collected counts use retained per-account talents and their collectedAt date, never
 * summed collection runs. The invitation distribution and its total include success,
 * skipped, failed and review records; in-flight sends and task counters are excluded.
 * Platform filters and chart labels use text; account-table cells retain brand icons.
 * Bright platform colors match across trend lines, legends, and quota indicators.
 */

import { useMemo, useState } from 'react'
import {
  UsersRound,
  Send,
  CircleX,
  Clock3,
  ArrowUpRight,
  Download,
  CalendarDays,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  XAxis,
  YAxis,
  Pie,
  PieChart,
  Cell,
} from 'recharts'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LoadingState } from '@/components/ui/loading-state'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AccountQuota } from './account-quota'
import { useDataQuery } from './data-query'
import { desktop } from './desktop'
import { exportRecords } from './format'
import { RecordsDialog } from './records'
import { Choice, PlatformBadge } from './shared'
import { useCommerce } from './store'
import { statusNames, type Platform, type ResultStatus } from './types'

type DashboardSummary = {
  collected: number
  counts: Record<string, number>
  accountCounts: Record<string, { success: number; review: number }>
  dates: { day: string; kuaishou: number; douyin: number }[]
}

export function Dashboard() {
  const accounts = useCommerce((s) => s.accounts)
  const records = useCommerce((s) => s.records)
  const talents = useCommerce((s) => s.talents)
  const [platform, setPlatform] = useState<Platform | 'all'>('all')
  const [accountId, setAccountId] = useState('all')
  const [days, setDays] = useState('7')
  const [recordFilter, setRecordFilter] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const available = useMemo(() => accounts.filter(
    (a) => platform === 'all' || a.platform === platform
  ), [accounts, platform])
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - Number(days) + 1)
  const startTime = start.getTime()
  const filtered = useMemo(() => desktop ? [] : records.filter(
    (r) =>
      (platform === 'all' || r.platform === platform) &&
      (accountId === 'all' || r.accountId === accountId) &&
      Date.parse(r.time) >= startTime
  ), [records, platform, accountId, startTime])
  const demoCollected = useMemo(() => {
    if (desktop) return 0
    const currentAccountIds = new Set(available.map((account) => account.id))
    let total = 0
    for (const talent of talents) {
      if (currentAccountIds.has(talent.sourceAccountId) &&
          (platform === 'all' || talent.platform === platform) &&
          (accountId === 'all' || talent.sourceAccountId === accountId) &&
          Date.parse(talent.collectedAt) >= startTime) total++
    }
    return total
  }, [talents, available, platform, accountId, startTime])
  const demoSummary = useMemo(() => {
    const dateBuckets = new Map<string, { day: string; kuaishou: number; douyin: number }>()
    for (let i = 0; i < Number(days); i++) {
      const date = new Date(startTime)
      date.setDate(date.getDate() + i)
      dateBuckets.set(date.toDateString(), {
        day: `${date.getMonth() + 1}/${date.getDate()}`,
        kuaishou: 0,
        douyin: 0,
      })
    }
    const counts = new Map<string, number>()
    const accountCounts = new Map<string, { success: number; review: number }>()
    for (const record of filtered) {
      counts.set(record.status, (counts.get(record.status) ?? 0) + 1)
      if (record.status === 'success' || record.status === 'review') {
        let account = accountCounts.get(record.accountId)
        if (!account) {
          account = { success: 0, review: 0 }
          accountCounts.set(record.accountId, account)
        }
        account[record.status]++
      }
      if (record.status === 'success') {
        const bucket = dateBuckets.get(new Date(record.time).toDateString())
        if (bucket) bucket[record.platform]++
      }
    }
    return { dates: [...dateBuckets.values()], counts, accountCounts }
  }, [filtered, startTime, days])
  const buckets = useMemo(() => Array.from({ length: Number(days) }, (_, i) => {
    const date = new Date(startTime)
    date.setDate(date.getDate() + i)
    const end = new Date(date)
    end.setDate(end.getDate() + 1)
    return {
      day: `${date.getMonth() + 1}/${date.getDate()}`,
      start: date.toISOString(),
      end: end.toISOString(),
    }
  }), [startTime, days])
  const since = new Date(startTime).toISOString()
  const summary = useDataQuery<DashboardSummary>({
    kind: 'dashboard',
    platform,
    accountId,
    since,
    accountIds: available.map((account) => account.id),
    buckets,
  })
  const collected = desktop ? summary.data?.collected ?? 0 : demoCollected
  const dates = desktop ? summary.data?.dates ?? [] : demoSummary.dates
  const counts = useMemo(() => desktop
    ? new Map(Object.entries(summary.data?.counts ?? {}))
    : demoSummary.counts, [summary.data, demoSummary])
  const accountCounts = useMemo(() => desktop
    ? new Map(Object.entries(summary.data?.accountCounts ?? {}))
    : demoSummary.accountCounts, [summary.data, demoSummary])
  const loading = Boolean(desktop && !summary.data && summary.loading)
  const error = desktop ? summary.error : ''
  const count = (status: string) => counts.get(status) ?? 0

  const metrics = [
    {
      label: '已采集达人',
      value: collected,
      icon: UsersRound,
      filter: 'all',
      color: 'text-foreground',
    },
    {
      label: '邀约成功',
      value: count('success'),
      icon: Send,
      filter: 'success',
      color: 'text-foreground',
    },
    {
      label: '发送失败',
      value: count('failed'),
      icon: CircleX,
      filter: 'failed',
      color: 'text-foreground',
    },
    {
      label: '待核实',
      value: count('review'),
      icon: Clock3,
      filter: 'review',
      color: 'text-amber-700',
    },
  ]
  const distribution = (
    ['success', 'skipped', 'failed', 'review'] as ResultStatus[]
  )
    .map((status, i) => ({
      status,
      name: statusNames[status],
      value: count(status),
      fill: ['#22c55e', '#8b5cf6', '#f43f5e', '#f59e0b'][i],
    }))
  const invitationTotal = distribution.reduce((total, item) => total + item.value, 0)
  async function exportCSV() {
    setExporting(true)
    try {
      if (await exportRecords(dates, '邀约报表.csv'))
        toast.success('邀约报表已导出')
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }
  return (
    <main className='page-content dashboard-page space-y-5'>
      <div className='page-toolbar flex-wrap justify-between'>
        <Tabs
          value={platform}
          onValueChange={(v) => {
            setPlatform(v as Platform | 'all')
            setAccountId('all')
          }}
        >
          <TabsList>
            <TabsTrigger value='all'>全部平台</TabsTrigger>
            <TabsTrigger value='kuaishou'>快手</TabsTrigger>
            <TabsTrigger value='douyin'>抖音</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className='flex items-center gap-3'>
          <Choice
            value={accountId}
            onChange={setAccountId}
            label='报表账号'
            options={[
              { value: 'all', label: '全部账号' },
              ...available.map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <span className='hidden text-muted-foreground xl:block'>
            <CalendarDays size={17} />
          </span>
          <Choice
            value={days}
            onChange={setDays}
            label='统计日期'
            options={[
              { value: '1', label: '今天' },
              { value: '7', label: '最近 7 天' },
              { value: '14', label: '最近 14 天' },
            ]}
          />
          <Button
            variant='outline'
            disabled={exporting || loading || Boolean(error)}
            onClick={exportCSV}
          >
            <Download />
            {exporting ? '正在导出' : '导出'}
          </Button>
        </div>
      </div>
      {loading ? (
        <LoadingState label='正在读取统计' className='min-h-[60vh]' />
      ) : error ? (
        <div role='alert' className='flex min-h-[60vh] items-center justify-center text-destructive'>
          {error}
        </div>
      ) : (
        <>
          <div className='grid grid-cols-2 gap-4 xl:grid-cols-4'>
            {metrics.map((m) => (
              <Card key={m.label} className='gap-4 py-5 shadow-none'>
                <CardHeader className='flex flex-row items-center justify-between px-5'>
                  <CardTitle className='text-sm font-normal text-muted-foreground'>
                    {m.label}
                  </CardTitle>
                  <m.icon
                    className='size-[18px] text-muted-foreground'
                    strokeWidth={1.6}
                  />
                </CardHeader>
                <CardContent className='flex items-end justify-between px-5'>
                  <span
                    className={`text-[32px] leading-none font-semibold tracking-tight tabular-nums ${m.color}`}
                  >
                    {m.value.toLocaleString()}
                  </span>
                  {m.filter !== 'all' && (
                    <Button
                      variant='ghost'
                      size='icon'
                      className='-mr-2 size-7 text-muted-foreground'
                      aria-label={`查看${m.label}`}
                      onClick={() => setRecordFilter(m.filter)}
                    >
                      <ArrowUpRight />
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
          <div className='grid grid-cols-1 gap-5 lg:grid-cols-3'>
            <Card className='gap-3 py-5 shadow-none lg:col-span-2'>
              <CardHeader className='flex flex-row items-center justify-between'>
                <CardTitle className='text-base font-semibold'>邀约趋势</CardTitle>
                <div className='flex gap-4 text-sm text-muted-foreground'>
                  <span className='flex items-center gap-2'>
                    <span className='size-2 rounded-full bg-[#f97316]' />
                    快手
                  </span>
                  <span className='flex items-center gap-2'>
                    <span className='size-2 rounded-full bg-[#3b82f6]' />
                    抖音
                  </span>
                </div>
              </CardHeader>
              <CardContent className='pl-2'>
                <ChartContainer
                  config={{
                    kuaishou: { label: '快手', color: '#f97316' },
                    douyin: { label: '抖音', color: '#3b82f6' },
                  }}
                  className='h-[200px] w-full'
                >
                  <AreaChart
                    accessibilityLayer
                    data={dates}
                    margin={{ left: 0, right: 12, top: 12, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray='3 3' />
                    <XAxis
                      dataKey='day'
                      axisLine={false}
                      tickLine={false}
                      tickMargin={12}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      width={40}
                      tickMargin={8}
                      allowDecimals={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='douyin'
                      fill='var(--color-douyin)'
                      fillOpacity={0.18}
                      stroke='var(--color-douyin)'
                      strokeWidth={2}
                    />
                    <Area
                      isAnimationActive={false}
                      type='monotone'
                      dataKey='kuaishou'
                      fill='var(--color-kuaishou)'
                      fillOpacity={0.18}
                      stroke='var(--color-kuaishou)'
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card className='gap-0 py-5 shadow-none'>
              <CardHeader>
                <CardTitle className='text-base font-semibold'>邀约结果</CardTitle>
              </CardHeader>
              <CardContent>
                <div className='relative mx-auto h-[175px] max-w-[230px]'>
                  <ChartContainer
                    config={{ value: { label: '人数' } }}
                    className='h-full w-full'
                  >
                    <PieChart>
                      <ChartTooltip content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        isAnimationActive={false}
                        data={distribution}
                        dataKey='value'
                        nameKey='name'
                        innerRadius={56}
                        outerRadius={73}
                        strokeWidth={4}
                        startAngle={90}
                        endAngle={-270}
                      >
                        {distribution.map((s) => (
                          <Cell key={s.status} fill={s.fill} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                  <div className='pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1'>
                    <strong className='text-2xl font-semibold tabular-nums'>
                      {invitationTotal.toLocaleString()}
                    </strong>
                    <span className='text-sm text-muted-foreground'>总记录</span>
                  </div>
                </div>
                <div className='grid grid-cols-2 gap-x-5 gap-y-3'>
                  {distribution.map((d) => (
                    <button
                      key={d.status}
                      onClick={() => setRecordFilter(d.status)}
                      className='flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted'
                    >
                      <span
                        className='size-2 rounded-full'
                        style={{ backgroundColor: d.fill }}
                      />
                      <span className='text-muted-foreground'>{d.name}</span>
                      <span className='ml-auto tabular-nums'>{d.value}</span>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className='gap-3 py-5 shadow-none'>
            <CardHeader>
              <CardTitle className='text-base font-semibold'>账号表现</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>店铺账号</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead className='text-right'>邀约成功</TableHead>
                    <TableHead className='text-right'>待核实</TableHead>
                    <TableHead className='w-[210px] pl-10'>剩余额度</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {available
                    .filter((a) => accountId === 'all' || a.id === accountId)
                    .map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className='font-medium'>{a.name}</TableCell>
                        <TableCell>
                          <PlatformBadge platform={a.platform} />
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {accountCounts.get(a.id)?.success ?? 0}
                        </TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {accountCounts.get(a.id)?.review ?? 0}
                        </TableCell>
                        <TableCell className='pl-10'>
                          <AccountQuota account={a} showProgress />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      {recordFilter !== null && (
        <RecordsDialog
          open
          onOpenChange={(v) => !v && setRecordFilter(null)}
          records={desktop ? undefined : filtered}
          scope={{ platform, accountId, since }}
          initialStatus={recordFilter}
        />
      )}
    </main>
  )
}
