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
  sessionId: string
  status: 'online' | 'expired' | 'offline'
  savedAt: string
  quota: number
  limit: number | null
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
  maxInvites: number
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
  source: string
  sourceAccountId: string
  collectedAt: string
}
export type InviteRecord = {
  id: string
  accountId: string
  platform: Platform
  talentId: string
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
