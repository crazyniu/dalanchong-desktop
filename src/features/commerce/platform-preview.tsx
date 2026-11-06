import { useState } from 'react'
import { Search, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Choice, NameAvatar, Pagination, PlatformBadge } from './shared'
import { defaultFilters, filterCandidates, useCommerce } from './store'
import type { Account, Filters } from './types'

export function PlatformPreview({ account }: { account: Account }) {
  const applied = useCommerce((s) => s.filters[account.id]) || defaultFilters
  const saveFilters = useCommerce((s) => s.saveFilters)
  const login = useCommerce((s) => s.login)
  const [draft, setDraft] = useState<Filters>(applied)
  const [page, setPage] = useState(1)
  const list = filterCandidates(account.platform, applied)
  if (account.status !== 'online')
    return (
      <div className='grid flex-1 place-content-center justify-items-center gap-4 bg-white'>
        <Store className='size-10 text-muted-foreground' />
        <h2 className='font-semibold'>{account.name}</h2>
        <Button onClick={() => login(account.id)}>模拟登录</Button>
      </div>
    )
  return (
    <div
      className='flex-1 overflow-auto bg-white'
      data-testid='platform-preview'
    >
      <div className='flex h-14 items-center gap-8 border-b px-6'>
        <strong className='flex items-center gap-2 text-base'>
          <PlatformBadge compact platform={account.platform} />
          {account.platform === 'kuaishou' ? '快分销' : '精选联盟'}
        </strong>
        <span className='font-medium'>
          {account.platform === 'kuaishou' ? '同行合作参考' : '达人广场'}
        </span>
        <Badge
          variant='outline'
          className='ml-auto font-normal text-muted-foreground'
        >
          网页预览
        </Badge>
      </div>
      <div className='p-6'>
        <form
          className='space-y-4'
          onSubmit={(e) => {
            e.preventDefault()
            saveFilters(account.id, { ...draft })
            setPage(1)
          }}
        >
          <div className='flex max-w-[660px] gap-2'>
            <div className='relative flex-1'>
              <Search className='absolute top-2.5 left-3 size-4 text-muted-foreground' />
              <Input
                aria-label='平台关键词'
                className='pl-9'
                placeholder='搜索关键词，如灭鼠'
                value={draft.keyword}
                onChange={(e) =>
                  setDraft({ ...draft, keyword: e.target.value })
                }
              />
            </div>
            <Button type='submit' className='px-6'>
              搜索
            </Button>
          </div>
          <div className='flex flex-wrap items-center gap-3'>
            <Choice
              label='平台类目'
              value={draft.category}
              onChange={(v) => setDraft({ ...draft, category: v })}
              options={[
                { value: 'all', label: '全部类目' },
                { value: '家居日用', label: '家居日用' },
                { value: '农资园艺', label: '农资园艺' },
              ]}
            />
            <Choice
              label='平台粉丝范围'
              value={draft.fans}
              onChange={(v) => setDraft({ ...draft, fans: v })}
              options={[
                { value: 'all', label: '粉丝不限' },
                { value: '10w', label: '10 万以上' },
                { value: 'under10w', label: '10 万以下' },
              ]}
            />
            <Choice
              label='平台达人等级'
              value={draft.level}
              onChange={(v) => setDraft({ ...draft, level: v })}
              options={[
                { value: 'all', label: '等级不限' },
                ...['LV1', 'LV2', 'LV3', 'LV4'].map((v) => ({
                  value: v,
                  label: v,
                })),
              ]}
            />
            <Button variant='outline' type='submit'>
              应用筛选
            </Button>
            <Button
              variant='ghost'
              type='button'
              onClick={() => {
                setDraft(defaultFilters)
                saveFilters(account.id, defaultFilters)
                setPage(1)
              }}
            >
              重置
            </Button>
          </div>
        </form>
        <div className='mt-6 mb-3 flex items-center gap-3'>
          <h2 className='font-semibold'>达人列表</h2>
          <span className='text-muted-foreground'>{list.length}</span>
          {applied.keyword && (
            <Badge variant='secondary'>{applied.keyword}</Badge>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>达人</TableHead>
              <TableHead>主营类目</TableHead>
              <TableHead>粉丝数</TableHead>
              <TableHead>等级</TableHead>
              <TableHead>来源</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.slice((page - 1) * 8, page * 8).map((r, i) => (
              <TableRow key={r.id}>
                <TableCell>
                  <span className='flex items-center gap-3'>
                    <NameAvatar name={r.name} index={i} />
                    <span className='font-medium'>{r.name}</span>
                  </span>
                </TableCell>
                <TableCell>{r.category}</TableCell>
                <TableCell>{(r.fans / 10000).toFixed(1)} 万</TableCell>
                <TableCell>{r.level}</TableCell>
                <TableCell className='text-muted-foreground'>
                  {r.source}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {!list.length && (
          <div className='py-20 text-center text-muted-foreground'>
            没有符合条件的达人
          </div>
        )}
        <Pagination
          page={page}
          pages={Math.ceil(list.length / 8)}
          total={list.length}
          onChange={setPage}
        />
      </div>
    </div>
  )
}
