import { useState } from 'react'
import { Download, ListFilter, RotateCcw, Send, UsersRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ClearDataButton } from './clear-data-button'
import { exportRecords, formatTime } from './format'
import {
  Choice,
  NameAvatar,
  Pagination,
  ResultBadge,
  SearchInput,
} from './shared'
import { useCommerce } from './store'
import {
  platformNames,
  statusNames,
  type CollectedTalent,
  type Platform,
} from './types'

export function CollectionList({
  platform,
  talents,
  selected,
  onSelect,
  onInvite,
  onCollect,
}: {
  platform: Platform
  talents: CollectedTalent[]
  selected: string[]
  onSelect: (ids: string[]) => void
  onInvite: (ids: string[]) => void
  onCollect: () => void
}) {
  const accounts = useCommerce((s) => s.accounts)
  const records = useCommerce((s) => s.records)
  const clearTalents = useCommerce((s) => s.clearTalents)
  const tasks = useCommerce((s) => s.tasks)
  const running = accounts.some(
    (a) => a.platform === platform && tasks[a.id]?.status === 'running'
  )
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [resultAccount, setResultAccount] = useState('all')
  const [minFans, setMinFans] = useState('')
  const [maxFans, setMaxFans] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const result = (id: string) =>
    records.find(
      (r) =>
        r.platform === platform &&
        r.talentId === id &&
        (resultAccount === 'all' || r.accountId === resultAccount)
    )
  const filtered = talents
    .filter(
      (t) =>
        (t.name + t.id + t.source).includes(query) &&
        (status === 'all' || (result(t.id)?.status || 'pending') === status) &&
        (minFans === '' ||
          (t.fans !== undefined && t.fans >= Number(minFans))) &&
        (maxFans === '' || (t.fans !== undefined && t.fans <= Number(maxFans)))
    )
    .sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt))
  const hasSelection = selected.length > 0
  const actionTalents = hasSelection
    ? talents
        .filter((t) => selected.includes(t.id))
        .sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt))
    : filtered
  const pages = Math.ceil(filtered.length / pageSize)
  const current = Math.min(page, Math.max(1, pages))
  const displayed = filtered.slice((current - 1) * pageSize, current * pageSize)
  const allSelected =
    displayed.length > 0 && displayed.every((t) => selected.includes(t.id))
  const anySelected = displayed.some((t) => selected.includes(t.id))
  const choosePage = (checked: boolean) =>
    onSelect(
      checked
        ? [...new Set([...selected, ...displayed.map((t) => t.id)])]
        : selected.filter((id) => !displayed.some((t) => t.id === id))
    )
  return (
    <div className='space-y-4 p-6'>
      <div className='flex flex-wrap items-center gap-2'>
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setPage(1)
          }}
          placeholder='搜索达人、ID、来源'
          className='min-w-40 flex-1'
        />
        <Choice
          label='列表邀约状态'
          className='w-28 min-w-0'
          value={status}
          onChange={(v) => {
            setStatus(v)
            setPage(1)
          }}
          options={[
            { value: 'all', label: '全部状态' },
            { value: 'pending', label: '未邀约' },
            ...Object.entries(statusNames).map(([value, label]) => ({
              value,
              label,
            })),
          ]}
        />
        <Choice
          label='查看账号邀约状态'
          className='w-36 min-w-0'
          value={resultAccount}
          onChange={(v) => {
            setResultAccount(v)
            setPage(1)
          }}
          options={[
            { value: 'all', label: '全部发送账号' },
            ...accounts
              .filter((a) => a.platform === platform)
              .map((a) => ({ value: a.id, label: a.name })),
          ]}
        />
        <div className='flex shrink-0 items-center gap-2'>
          <span className='text-sm whitespace-nowrap'>粉丝数</span>
          <Input
            type='number'
            min={0}
            step={1}
            aria-label='粉丝下限'
            placeholder='最低'
            value={minFans}
            onChange={(event) => {
              setMinFans(event.target.value)
              setPage(1)
            }}
            className='w-24 bg-white'
          />
          <span className='text-muted-foreground'>至</span>
          <Input
            type='number'
            min={0}
            step={1}
            aria-label='粉丝上限'
            placeholder='最高'
            value={maxFans}
            onChange={(event) => {
              setMaxFans(event.target.value)
              setPage(1)
            }}
            className='w-24 bg-white'
          />
          {(minFans !== '' || maxFans !== '') && (
            <Button
              size='icon'
              variant='ghost'
              aria-label='重置粉丝筛选'
              title='重置粉丝筛选'
              onClick={() => {
                setMinFans('')
                setMaxFans('')
                setPage(1)
              }}
            >
              <RotateCcw />
            </Button>
          )}
        </div>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          <Button
            onClick={() => onInvite(actionTalents.map((t) => t.id))}
            disabled={!actionTalents.length}
          >
            <Send />
            {hasSelection ? '邀约所选' : '批量邀约'}
          </Button>
          <Button
            variant='outline'
            disabled={!actionTalents.length}
            onClick={() =>
              exportRecords(
                actionTalents.map((t) => ({
                  达人: t.name,
                  达人ID: t.id,
                  粉丝数: t.fans ?? '',
                  来源: t.source,
                  采集账号:
                    accounts.find((a) => a.id === t.sourceAccountId)?.name ||
                    '已移除账号',
                  采集时间: formatTime(t.collectedAt),
                })),
                '采集达人.csv'
              )
            }
          >
            <Download />
            {hasSelection ? '导出所选' : '全部导出'}
          </Button>
          <ClearDataButton
            label={hasSelection ? '删除所选' : '全部删除'}
            actionLabel='删除'
            description={
              hasSelection
                ? `删除已勾选的 ${selected.length} 位达人，包含其他页和筛选外的已选达人，无法恢复。`
                : `删除${platformNames[platform]}全部 ${talents.length} 位已采集达人，包含筛选外的数据，无法恢复。`
            }
            disabled={!talents.length || running}
            onClear={async () => {
              await clearTalents(platform, hasSelection ? selected : undefined)
              onSelect([])
              setPage(1)
            }}
          />
        </div>
      </div>
      {hasSelection && (
        <div className='flex items-center gap-2'>
          <Badge variant='secondary'>已选 {selected.length} 位</Badge>
          <Button size='sm' variant='ghost' onClick={() => onSelect([])}>
            取消选择
          </Button>
        </div>
      )}
      <div className='max-h-[50vh] overflow-y-auto rounded-lg border bg-white'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='w-12 pl-4'>
                <Checkbox
                  aria-label='全选当前页达人'
                  checked={
                    allSelected ? true : anySelected ? 'indeterminate' : false
                  }
                  onCheckedChange={(v) => choosePage(v === true)}
                  disabled={!displayed.length}
                />
              </TableHead>
              <TableHead>达人</TableHead>
              <TableHead>粉丝数</TableHead>
              <TableHead>采集来源</TableHead>
              <TableHead>采集时间</TableHead>
              <TableHead>最近邀约</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((t, i) => {
              const record = result(t.id)
              return (
                <TableRow
                  key={t.id}
                  data-state={selected.includes(t.id) ? 'selected' : undefined}
                >
                  <TableCell className='pl-4'>
                    <Checkbox
                      aria-label={`选择${t.name}`}
                      checked={selected.includes(t.id)}
                      onCheckedChange={(v) =>
                        onSelect(
                          v
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <div className='flex items-center gap-3'>
                      <NameAvatar name={t.name} index={i} />
                      <div>
                        <div className='font-medium'>{t.name}</div>
                        <div className='mt-1 text-sm text-muted-foreground'>
                          {t.id}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className='tabular-nums'>
                    {t.fans === undefined
                      ? '—'
                      : t.fans >= 10000
                        ? `${(t.fans / 10000).toFixed(1)} 万`
                        : t.fans.toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <div className='max-w-64 truncate'>{t.source}</div>
                    <div className='mt-1 text-sm text-muted-foreground'>
                      {accounts.find((a) => a.id === t.sourceAccountId)?.name ||
                        '已移除账号'}
                    </div>
                  </TableCell>
                  <TableCell className='text-muted-foreground tabular-nums'>
                    {formatTime(t.collectedAt)}
                  </TableCell>
                  <TableCell>
                    {record ? (
                      <div className='space-y-1'>
                        <ResultBadge status={record.status} />
                        <div className='text-sm text-muted-foreground'>
                          {accounts.find((a) => a.id === record.accountId)
                            ?.name || '已移除账号'}
                        </div>
                      </div>
                    ) : (
                      <Badge
                        variant='outline'
                        className='font-normal text-muted-foreground'
                      >
                        未邀约
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!filtered.length && (
          <div className='grid place-content-center justify-items-center gap-4 py-24 text-muted-foreground'>
            {talents.length ? (
              <ListFilter className='size-9' />
            ) : (
              <UsersRound className='size-9' />
            )}
            <p>{talents.length ? '没有符合条件的达人' : '还没有采集达人'}</p>
            {!talents.length && (
              <Button variant='outline' onClick={onCollect}>
                去采集
              </Button>
            )}
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
    </div>
  )
}
