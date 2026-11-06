import type { WebviewTag } from 'electron'
import { toast } from 'sonner'
import { create } from 'zustand'
import { useCommerce } from './store'

export const urls = {
  kuaishou: 'https://cps.kwaixiaodian.com/zone/daren-match/peer-reference',
  douyin: 'https://buyin.jinritemai.com/dashboard/servicehall/daren-square',
}
export const guests = new Map<string, WebviewTag>()
type GuestState = { status: 'loading' | 'ready' | 'error'; error?: string }
export const useGuestState = create<{
  sessions: Record<string, GuestState>
  attempts: Record<string, number>
}>(() => ({ sessions: {}, attempts: {} }))
export function setGuestState(id: string, state: GuestState) {
  useGuestState.setState((s) => ({ sessions: { ...s.sessions, [id]: state } }))
}
export function retryGuest(id: string) {
  useGuestState.setState((s) => ({
    sessions: { ...s.sessions, [id]: { status: 'loading' } },
    attempts: { ...s.attempts, [id]: (s.attempts[id] || 0) + 1 },
  }))
}
export function browserError(error: unknown) {
  return (error as Error).message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    ''
  )
}
export async function reloadPlatform(id: string): Promise<boolean> {
  const guest = guests.get(id)
  if (!guest) {
    retryGuest(id)
    return false
  }
  try {
    await guest.loadURL(
      urls[useCommerce.getState().accounts.find((a) => a.id === id)!.platform]
    )
    return true
  } catch (error) {
    const e = error as Error & { code?: string; errno?: number }
    if (
      e.code === 'ERR_ABORTED' ||
      e.errno === -3 ||
      e.message.includes('ERR_ABORTED')
    ) {
      toast.info('页面正在跳转，请加载完成后重试')
    } else {
      toast.error(`网页跳转失败：${browserError(e)}`)
    }
    return false
  }
}
