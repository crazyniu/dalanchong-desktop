/**
 * AI module map
 * Purpose: edit local invitation status, gender, exact fan bounds, and source filters.
 * Entry: CollectionFilterDialog, matchesTalentFilters, activeTalentFilterCount, and
 * talentValue are consumed by collection-list.tsx.
 * Flow: the dialog copies applied filters into a draft. Apply publishes changes;
 * Reset edits the draft, and explicit Close/Cancel discard it.
 * Invariants: category/commerce filtering belongs to the platform webpage before
 * collection. Local source options come from this account's rows and the selector is
 * omitted when none exist. Zero fans is valid; missing fans cannot match active bounds.
 * Search, selection, pagination, CSV, and profile navigation remain table-owned.
 */

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Choice } from './shared'
import type { CollectedTalent } from './types'

export type TalentFilters = {
  status: 'all' | 'pending' | 'success'
  choices: { source?: string; gender?: '男' | '女' | 'unknown' }
  ranges: { fans?: { min: string; max: string } }
}

export const emptyTalentFilters: TalentFilters = {
  status: 'all',
  choices: {},
  ranges: {},
}

export function talentValue(
  value: CollectedTalent[keyof CollectedTalent]
): string | number {
  if (Array.isArray(value)) return value.join(' / ')
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (value == null) return ''
  const text = value.trim()
  return /^(?:[¥￥]\s*)?(?:[-—–]+|NaN)$/i.test(text) ? '' : text
}

export function matchesTalentFilters(
  talent: CollectedTalent,
  filters: TalentFilters,
  status: string
) {
  if (filters.status !== 'all' && filters.status !== status) return false
  if (filters.choices.source && talent.source !== filters.choices.source) return false
  const gender = talent.gender === '男' || talent.gender === '女' ? talent.gender : 'unknown'
  if (filters.choices.gender && gender !== filters.choices.gender) return false
  const { min, max } = filters.ranges.fans || { min: '', max: '' }
  if (min === '' && max === '') return true
  const fans = talentValue(talent.fans)
  return (
    typeof fans === 'number' &&
    (min === '' || fans >= Number(min)) &&
    (max === '' || fans <= Number(max))
  )
}

export function activeTalentFilterCount(filters: TalentFilters) {
  const { min, max } = filters.ranges.fans || { min: '', max: '' }
  return (
    Number(filters.status !== 'all') +
    Number(Boolean(filters.choices.source)) +
    Number(Boolean(filters.choices.gender)) +
    Number(min !== '' || max !== '')
  )
}

export function CollectionFilterDialog({
  open,
  onOpenChange,
  filters,
  onApply,
  sources,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TalentFilters
  onApply: (filters: TalentFilters) => void
  sources: string[]
}) {
  const [draft, setDraft] = useState(filters)
  const fans = draft.ranges.fans || { min: '', max: '' }
  function setFans(bound: 'min' | 'max', value: string) {
    setDraft((current) => ({
      ...current,
      ranges: {
        fans: { min: '', max: '', ...current.ranges.fans, [bound]: value },
      },
    }))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className='max-h-[85vh] overflow-hidden p-0 sm:max-w-3xl'
      >
        <form
          className='flex max-h-[85vh] min-h-0 flex-col'
          onSubmit={(event) => {
            event.preventDefault()
            onApply(draft)
          }}
        >
          <DialogHeader className='px-6 pt-6 text-left'>
            <DialogTitle>筛选达人</DialogTitle>
          </DialogHeader>
          <div className='grid min-h-0 gap-4 overflow-y-auto p-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>邀约状态</div>
              <Choice
                label='邀约状态'
                className='w-full'
                value={draft.status}
                onChange={(status) =>
                  setDraft((current) => ({
                    ...current,
                    status: status as TalentFilters['status'],
                  }))
                }
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'pending', label: '未邀约' },
                  { value: 'success', label: '已邀约' },
                ]}
              />
            </div>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>粉丝数</div>
              <div className='flex items-center gap-2'>
                <Input
                  type='number'
                  min={0}
                  max={fans.max || undefined}
                  step={1}
                  aria-label='粉丝数最小值'
                  placeholder='最小值'
                  value={fans.min}
                  onChange={(event) => setFans('min', event.target.value)}
                />
                <span className='text-muted-foreground'>至</span>
                <Input
                  type='number'
                  min={fans.min || 0}
                  step={1}
                  aria-label='粉丝数最大值'
                  placeholder='最大值'
                  value={fans.max}
                  onChange={(event) => setFans('max', event.target.value)}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>达人性别</div>
              <Choice
                label='达人性别'
                className='w-full'
                value={draft.choices.gender || '__all__'}
                onChange={(gender) =>
                  setDraft((current) => ({
                    ...current,
                    choices: {
                      ...current.choices,
                      gender: gender === '__all__'
                        ? undefined
                        : gender as TalentFilters['choices']['gender'],
                    },
                  }))
                }
                options={[
                  { value: '__all__', label: '全部' },
                  { value: '男', label: '男' },
                  { value: '女', label: '女' },
                  { value: 'unknown', label: '未知' },
                ]}
              />
            </div>
            {sources.length > 0 && (
              <div className='space-y-2'>
                <div className='text-sm font-medium'>采集来源</div>
                <Choice
                  label='采集来源'
                  className='w-full'
                  value={draft.choices.source || '__all__'}
                  onChange={(source) =>
                    setDraft((current) => ({
                      ...current,
                      choices: {
                        ...current.choices,
                        source: source === '__all__' ? '' : source,
                      },
                    }))
                  }
                  options={[
                    { value: '__all__', label: '全部' },
                    ...sources.map((source) => ({ value: source, label: source })),
                  ]}
                />
              </div>
            )}
          </div>
          <DialogFooter className='border-t px-6 py-4'>
            <Button
              type='button'
              variant='ghost'
              className='sm:mr-auto'
              onClick={() => setDraft(emptyTalentFilters)}
            >
              重置
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type='submit'>应用筛选</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
