/**
 * AI module map
 * Purpose: centralize invitation-domain types and Chinese display labels.
 * Entry: Account, InviteConfig, CollectedTalent, InviteRecord, DiagnosticLog, and Task
 * are shared by commerce screens, desktop.ts, and runtime persistence.
 * Invariants: sending/review are meaningful uncertain-result states; null maxInvites
 * means no user cap, while quota limits remain independent. IDs and platform/account
 * scope must survive serialization unchanged. This module performs no platform calls.
 * Task.activity is a bounded session-only collection stream, separate from error logs.
 * Task.retryAt is the runner's retry deadline in epoch milliseconds; views only
 * derive its remaining seconds and never schedule requests themselves.
 * CollectedTalent's optional profile/commerce fields come from the collection response;
 * missing fields remain absent in older snapshots. Amount strings retain disclosed
 * ranges in yuan; Kuaishou sales belong to the source shop, while Douyin sales describe
 * the talent. View metrics are Kuaishou averages and Douyin 30-day totals.
 * InviteRecord.talentUid retains the actual profile UID independently of talentId,
 * so history can open Douyin profiles after the collected row has been removed.
 * Account quota is a dated platform observation; null means it needs an update,
 * while zero is a confirmed remaining balance. It never controls invitation sends.
 */

export type Platform = 'kuaishou' | 'douyin'
export type ResultStatus =
  | 'success'
  | 'failed'
  | 'review'
  | 'skipped'
  | 'sending'
export type Account = {
  id: string
  platform: Platform
  name: string
  shopId: string
  shopName?: string
  sessionId: string
  status: 'online' | 'expired' | 'offline'
  savedAt: string
  quota: number | null
  limit: number | null
  quotaObservedAt?: string
  quotaError?: string
  quotaRows?: {
    label: string
    remaining: number
    total: number
    used: number
  }[]
}
export type InviteConfig = {
  products: string
  message: string
  phone: string
  wechat: string
  interval: number
  maxInvites: number | null
}
export type Filters = {
  keyword: string
  category: string
  fans: string
  level: string
}
export type Candidate = {
  id: string
  name: string
  fans: number
  category: string
  level: string
  source: string
}
export type CollectedTalent = {
  id: string
  platform: Platform
  uid?: string
  name: string
  fans?: number
  avatarUrl?: string
  gender?: string
  region?: string
  level?: string
  categories?: string[]
  contentType?: string
  salesMode?: string
  sales7d?: string
  sales30d?: string
  settlement30d?: string
  liveSales30d?: string
  videoSales30d?: string
  imageTextSales30d?: string
  windowSales30d?: string
  liveCount30d?: number
  videoCount30d?: number
  liveViews30d?: number
  videoViews30d?: number
  avgLiveSales?: string
  avgVideoSales?: string
  cooperationProducts30d?: number
  cooperationLevel?: string
  replyRate?: string
  source: string
  sourceAccountId: string
  collectedAt: string
}
export type InviteRecord = {
  id: string
  accountId: string
  platform: Platform
  talentId: string
  talentUid?: string
  name: string
  time: string
  status: ResultStatus
  source: string
  products: string
  message: string
  note: string
  resolution?: string
  response?: DiagnosticResponse
}
export type DiagnosticResponse = {
  path: string
  method?: string
  status?: number
  code?: string | number
  message?: string
  body?: unknown
  requestId?: string
}
export type DiagnosticLog = {
  id: string
  time: string
  level: 'info' | 'success' | 'error'
  message: string
  accountId?: string
  platform?: Platform
  taskId?: string
  kind?: 'collect' | 'invite'
  response?: DiagnosticResponse
}
export type TaskLog = {
  response?: DiagnosticResponse
  time: string
  message: string
  level: 'info' | 'success' | 'error'
}
export type Task = {
  startedAt?: string
  logs?: TaskLog[]
  activity?: TaskLog[]
  kind?: 'collect' | 'invite'
  accountId: string
  status: 'running' | 'stopped' | 'done'
  total: number
  collected: number
  processed: number
  success: number
  skipped: number
  failed: number
  review: number
  current: string
  retryAt?: number
  filters: Filters
}
export const platformNames = { kuaishou: '快手', douyin: '抖音' }
export const statusNames: Record<ResultStatus, string> = {
  success: '已邀约',
  failed: '发送失败',
  review: '待核实',
  skipped: '已跳过',
  sending: '发送中',
}
