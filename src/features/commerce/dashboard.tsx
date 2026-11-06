import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  UsersRound,
  Send,
  CircleX,
  Clock3,
  ArrowUpRight,
  Download,
  CalendarDays,
  History,
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
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { exportRecords } from './format'
import { RecordsDialog } from './records'
import { Choice, NameAvatar, PlatformBadge } from './shared'
import { useCommerce } from './store'
import { statusNames, type Platform, type ResultStatus } from './types'

export function Dashboard() {
  const accounts = useCommerce((s) => s.accounts)
  const records = useCommerce((s) => s.records)
  const select = useCommerce((s) => s.selectAccount)
  const [platform, setPlatform] = useState('all')
  const [accountId, setAccountId] = useState('all')
  const [days, setDays] = useState('7')
  const [recordFilter, setRecordFilter] = useState<string | null>(null)
  const collections = useCommerce((s) => s.collections)
  const navigate = useNavigate()
  const available = accounts.filter(
    (a) => platform === 'all' || a.platform === platform
  )
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - Number(days) + 1)
  const filtered = records.filter(
    (r) =>
      (platform === 'all' || r.platform === platform) &&
      (accountId === 'all' || r.accountId === accountId) &&
      Date.parse(r.time) >= start.getTime()
  )
  const count = (status: string) =>
    filtered.filter((r) => r.status === status).length
  const collected = collections
    .filter(
      (c) =>
        (platform === 'all' || c.platform === platform) &&
        (accountId === 'all' || c.accountId === accountId) &&
        Date.parse(c.time) >= start.getTime()
    )
    .reduce((n, c) => n + c.count, 0)

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
  const dates = Array.from({ length: Number(days) }, (_, i) => {
    const date = new Date(start)
    date.setDate(date.getDate() + i)
    const key = date.toLocaleDateString('sv-SE')
    const list = filtered.filter(
      (r) => new Date(r.time).toLocaleDateString('sv-SE') === key
    )
    return {
      day: `${date.getMonth() + 1}/${date.getDate()}`,
      kuaishou: list.filter(
        (r) => r.platform === 'kuaishou' && r.status === 'success'
      ).length,
      douyin: list.filter(
        (r) => r.platform === 'douyin' && r.status === 'success'
      ).length,
    }
  })
  const distribution = (
    ['success', 'skipped', 'failed', 'review'] as ResultStatus[]
  ).map((status, i) => ({
    status,
    name: statusNames[status],
    value: count(status),
    fill: ['#243c32', '#a6b7ad', '#e9a4a0', '#edc77d'][i],
  }))
  return (
    <main className='page-content dashboard-page space-y-5'>
      <div className='page-toolbar flex-wrap justify-between'>
        <Tabs
          value={platform}
          onValueChange={(v) => {
            setPlatform(v)
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
            onClick={() => exportRecords(dates, '邀约报表.csv')}
          >
            <Download />
            导出
          </Button>
        </div>
      </div>
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
                <span className='size-2 rounded-full bg-[#273f34]' />
                快手
              </span>
              <span className='flex items-center gap-2'>
                <span className='size-2 rounded-full bg-[#9aada0]' />
                抖音
              </span>
            </div>
          </CardHeader>
          <CardContent className='pl-2'>
            <ChartContainer
              config={{
                kuaishou: { label: '快手', color: '#273f34' },
                douyin: { label: '抖音', color: '#9aada0' },
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
                  fillOpacity={0.14}
                  stroke='var(--color-douyin)'
                  strokeWidth={2}
                />
                <Area
                  isAnimationActive={false}
                  type='monotone'
                  dataKey='kuaishou'
                  fill='var(--color-kuaishou)'
                  fillOpacity={0.1}
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
                  {filtered.length.toLocaleString()}
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
        <CardHeader className='flex flex-row items-center justify-between'>
          <CardTitle className='text-base font-semibold'>账号表现</CardTitle>
          <Button
            variant='ghost'
            className='-mr-2 h-8 text-muted-foreground'
            onClick={() => setRecordFilter('all')}
          >
            <History />
            邀约记录
          </Button>
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
                <TableHead className='w-24' />
              </TableRow>
            </TableHeader>
            <TableBody>
              {available
                .filter((a) => accountId === 'all' || a.id === accountId)
                .map((a, i) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <span className='flex items-center gap-3'>
                        <NameAvatar name={a.name} index={i} />
                        <span className='font-medium'>{a.name}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <PlatformBadge platform={a.platform} />
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {
                        filtered.filter(
                          (r) => r.accountId === a.id && r.status === 'success'
                        ).length
                      }
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {
                        filtered.filter(
                          (r) => r.accountId === a.id && r.status === 'review'
                        ).length
                      }
                    </TableCell>
                    <TableCell className='pl-10'>
                      <div className='flex justify-between text-sm'>
                        <span>
                          {a.platform === 'kuaishou' ? '今日' : '本周'}
                        </span>
                        <span className='tabular-nums'>
                          {a.quota}
                          {a.limit !== null && ` / ${a.limit}`}
                        </span>
                      </div>
                      <Progress
                        value={a.limit ? (a.quota / a.limit) * 100 : 0}
                        className='mt-2 h-1.5 bg-muted'
                      />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => {
                          select(a.platform as Platform, a.id)
                          navigate({
                            to:
                              a.platform === 'kuaishou'
                                ? '/kuaishou'
                                : '/douyin',
                          })
                        }}
                      >
                        进入
                        <ArrowUpRight />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {recordFilter !== null && (
        <RecordsDialog
          open
          onOpenChange={(v) => !v && setRecordFilter(null)}
          records={filtered}
          initialStatus={recordFilter}
        />
      )}
    </main>
  )
}
