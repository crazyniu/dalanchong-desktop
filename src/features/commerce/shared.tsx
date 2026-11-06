import { Music2, Video, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  platformNames,
  statusNames,
  type Platform,
  type ResultStatus,
} from './types'

export function PlatformBadge({
  platform,
  compact = false,
}: {
  platform: Platform
  compact?: boolean
}) {
  const Icon = platform === 'kuaishou' ? Video : Music2
  return (
    <span className='inline-flex shrink-0 items-center gap-2'>
      <span
        className={cn(
          'inline-flex size-6 items-center justify-center rounded-md',
          platform === 'kuaishou'
            ? 'bg-orange-100 text-orange-700'
            : 'bg-zinc-900 text-white'
        )}
      >
        <Icon size={14} />
      </span>
      {!compact && <span>{platformNames[platform]}</span>}
    </span>
  )
}
export function ResultBadge({ status }: { status: ResultStatus }) {
  return (
    <Badge
      variant='outline'
      className={cn('gap-1.5 border-0 px-2 py-1 font-normal', {
        'bg-emerald-50 text-emerald-700': status === 'success',
        'bg-red-50 text-red-700': status === 'failed',
        'bg-amber-50 text-amber-800': status === 'review',
        'bg-muted text-muted-foreground': status === 'skipped',
      })}
    >
      <span className='size-1.5 rounded-full bg-current' />
      {statusNames[status]}
    </Badge>
  )
}
export function NameAvatar({
  name,
  index = 0,
}: {
  name: string
  index?: number
}) {
  const colors = [
    'bg-slate-100 text-slate-700',
    'bg-orange-50 text-orange-800',
    'bg-emerald-50 text-emerald-800',
    'bg-violet-50 text-violet-800',
  ]
  return (
    <Avatar className='size-9 rounded-lg'>
      <AvatarFallback
        className={cn('rounded-lg text-sm', colors[index % colors.length])}
      >
        {name.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  )
}
export function Choice({
  value,
  onChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  label: string
  className?: string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        aria-label={label}
        className={cn('min-w-32 bg-white', className)}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
export function SearchInput({
  value,
  onChange,
  placeholder = '搜索达人',
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className='absolute top-2.5 left-3 size-4 text-muted-foreground' />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className='bg-white pl-9'
      />
    </div>
  )
}
export function Pagination({
  page,
  pages,
  total,
  pageSize,
  onChange,
  onPageSizeChange,
}: {
  page: number
  pages: number
  total: number
  pageSize: number
  onChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}) {
  return (
    <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 py-3 text-sm'>
      <div className='flex items-center gap-3'>
        <span className='text-muted-foreground'>
          共 {total.toLocaleString()} 条
        </span>
        <Choice
          label='每页数量'
          value={String(pageSize)}
          onChange={(value) => onPageSizeChange(Number(value))}
          options={[10, 20, 50, 100].map((size) => ({
            value: String(size),
            label: `${size} 条 / 页`,
          }))}
        />
      </div>
      <div className='flex flex-wrap items-center gap-3'>
        <span className='tabular-nums'>
          {page} / {Math.max(1, pages)}
        </span>
        <Button
          variant='outline'
          size='icon'
          className='size-8'
          aria-label='上一页'
          disabled={page === 1}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant='outline'
          size='icon'
          className='size-8'
          aria-label='下一页'
          disabled={page >= pages}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight />
        </Button>
        <form
          className='flex items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            onChange(Number(new FormData(event.currentTarget).get('page')))
          }}
        >
          <Input
            key={`${page}-${pageSize}`}
            name='page'
            type='number'
            aria-label='跳转页码'
            min={1}
            max={Math.max(1, pages)}
            step={1}
            required
            defaultValue={page}
            disabled={!total}
            className='h-8 w-20 bg-white tabular-nums'
          />
          <Button type='submit' size='sm' variant='outline' disabled={!total}>
            跳转
          </Button>
        </form>
      </div>
    </div>
  )
}
