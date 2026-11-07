/**
 * AI module map
 * Purpose: display the same observed quota in dashboard and account-management tables.
 * Entry: AccountQuota receives an account; the dashboard also requests a progress bar.
 * Flow: runtime supplies the balance and observation time; invalid observations render
 * as pending or failed. A mounted timer expires the display at the platform reset time.
 * Invariants: Kuaishou resets daily and Douyin weekly on Monday in UTC+8. Missing totals
 * have no percentage bar; null is unknown and zero remains a real balance. This component
 * never queries the platform, estimates balances, or changes persistent account data.
 */

import { useEffect, useReducer } from 'react'
import { Progress } from '@/components/ui/progress'
import { formatTime } from './format'
import type { Account } from './types'

function quotaPeriodEnd(account: Account) {
  if (!account.quotaObservedAt) return 0
  const offset = 8 * 60 * 60 * 1000
  const date = new Date(Date.parse(account.quotaObservedAt) + offset)
  const days = account.platform === 'kuaishou'
    ? 1
    : 7 - ((date.getUTCDay() + 6) % 7)
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + days)
  return date.getTime() - offset
}

export function AccountQuota({
  account,
  showProgress = false,
}: {
  account: Account
  showProgress?: boolean
}) {
  const [, refresh] = useReducer((version: number) => version + 1, 0)
  const expiresAt = quotaPeriodEnd(account)
  useEffect(() => {
    const delay = expiresAt - Date.now()
    if (delay <= 0) return
    const timer = window.setTimeout(refresh, delay)
    return () => window.clearTimeout(timer)
  }, [expiresAt])

  if (account.quotaError)
    return <span className='text-muted-foreground'>读取失败</span>
  if (account.status !== 'online' || account.quota === null || Date.now() >= expiresAt)
    return <span className='text-muted-foreground'>待更新</span>

  return (
    <div title={`读取时间：${formatTime(account.quotaObservedAt!)}`}>
      <div className='flex justify-between gap-4 text-sm'>
        <span>{account.platform === 'kuaishou' ? '今日' : '本周'}</span>
        <span className='tabular-nums'>
          {account.quota.toLocaleString()}
          {account.limit !== null && ` / ${account.limit.toLocaleString()}`}
        </span>
      </div>
      {showProgress && account.limit !== null && account.limit > 0 && (
        <Progress
          value={(account.quota / account.limit) * 100}
          aria-label={`${account.name}剩余额度`}
          className={`mt-2 h-1.5 ${account.platform === 'kuaishou'
            ? 'bg-orange-100 [&_[data-slot=progress-indicator]]:bg-[#f97316]'
            : 'bg-blue-100 [&_[data-slot=progress-indicator]]:bg-[#3b82f6]'
          }`}
        />
      )}
    </div>
  )
}
