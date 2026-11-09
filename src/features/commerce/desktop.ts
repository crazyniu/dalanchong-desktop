/**
 * AI module map
 * Purpose: define the shared desktop event/method contracts and select native vs preview mode.
 * Entry: desktop is a singleton bridge inside Tauri and undefined in browser preview.
 * Flow: RuntimeData, LicenseState, UpdateState, and DesktopEvent connect Rust events,
 * runtime.mjs orchestration, and React stores without exposing native credentials.
 * Runtime events patch changed domains; task events replace one account/kind task.
 * Task maps use `${accountId}:${kind}` keys while Task.accountId keeps account identity.
 * stop cancels one kind when specified, or every task for the account when omitted.
 * initialize and late runtime replay still provide complete task snapshots.
 * exportCsv resolves true after native file writing and false when the user cancels.
 * Invariant: interface changes must match runtime implementations and native payloads;
 * UI validity is display state, not authorization. Never create a fake production bridge.
 */

import { createDesktopBridge } from '@/desktop-runtime'
import { isTauri } from '@tauri-apps/api/core'
import type { DataQuery } from './data-query'
import type {
  Account,
  InviteConfig,
  InviteRecord,
  Task,
  CollectedTalent,
  DiagnosticLog,
  Filters,
} from './types'

export type CollectionEvent = {
  id: string
  accountId: string
  platform: Account['platform']
  time: string
  count: number
}
export type RuntimeData = {
  dataRevision: number
  talentCounts: Record<string, number>
  logs: DiagnosticLog[]
  talents: CollectedTalent[]
  records: InviteRecord[]
  tasks: Record<string, Task>
  collections: CollectionEvent[]
  accounts?: Account[]
  configs?: Record<string, InviteConfig>
  filters?: Record<string, Filters>
  selected?: Record<Account['platform'], string>
}
export type LicenseDiagnostic = {
  time: string
  action: string
  endpoint: string
  stage: string
  detail: string
  httpStatus?: number | null
  requestId?: string | null
  cfRay?: string | null
  contentType?: string | null
  appVersion: string
  os: string
}
export type LicenseState = {
  deviceId: string
  checked: boolean
  valid: boolean
  reason: string
  message: string
  hasCode: boolean
  activatedAt: string | null
  expiresAt: string | null
  diagnostic?: LicenseDiagnostic | null
}
export type UpdateState = {
  currentVersion: string
  status:
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'waiting'
    | 'installing'
    | 'error'
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
  retryAction?: 'check' | 'update'
  canInstall: boolean
}
export type DesktopEvent =
  | { type: 'update'; state: UpdateState }
  | { type: 'license'; state: LicenseState }
  | { type: 'runtime'; data: Partial<RuntimeData> }
  | { type: 'task'; task: Task }
  | { type: 'account'; id: string; patch: Partial<Account> }
  | { type: 'capture'; id: string; ready: boolean }
  | { type: 'error'; message: string }
declare global {
  interface Window {
    desktop?: {
      getUpdateState: () => Promise<UpdateState>
      checkForUpdates: () => Promise<UpdateState>
      applyUpdate: (beforeInstall?: () => Promise<void>) => Promise<UpdateState>
      getLicenseState: () => Promise<LicenseState>
      activateLicense: (
        code: string
      ) => Promise<{
        valid: boolean
        message?: string
        diagnostic?: LicenseDiagnostic | null
      }>
      initialize: () => Promise<RuntimeData>
      queryData: <T>(request: DataQuery) => Promise<T>
      deleteData: (request: DataQuery) => Promise<void>
      exportData: (request: DataQuery) => Promise<{ saved: boolean; count: number }>
      exportCsv: (filename: string, content: string) => Promise<boolean>
      exportLogs: (accountId: string) => Promise<boolean>
      clearLogs: (
        platform: Account['platform'] | 'all',
        accountId: string
      ) => Promise<void>
      clearTalents: (
        platform: Account['platform'],
        accountId: string,
        ids?: string[]
      ) => Promise<void>
      clearRecords: (ids: string[]) => Promise<void>
      prepareAccount: (
        account: Pick<Account, 'id' | 'platform'>
      ) => Promise<void>
      openAccountLogin: (
        account: Pick<Account, 'id' | 'platform' | 'name'>,
        closeOnLogin?: boolean
      ) => Promise<void>
      removeAccount: (
        accountId: string,
        platform: Account['platform']
      ) => Promise<void>
      collect: (accountId: string) => Promise<void>
      start: (
        accountId: string,
        config: InviteConfig,
        talentIds: string[]
      ) => Promise<void>
      stop: (accountId: string, kind?: Task['kind']) => Promise<void>
      resolveRecord: (id: string, sent: boolean) => Promise<void>
      onEvent: (listener: (event: DesktopEvent) => void) => () => void
    }
  }
}
export type DesktopBridge = NonNullable<Window['desktop']>
export const desktop: DesktopBridge | undefined = isTauri()
  ? createDesktopBridge()
  : undefined
