import { createDesktopBridge } from '@/desktop-runtime'
import { isTauri } from '@tauri-apps/api/core'
import type {
  Account,
  InviteConfig,
  InviteRecord,
  Task,
  CollectedTalent,
  DiagnosticLog,
} from './types'

export type CollectionEvent = {
  id: string
  accountId: string
  platform: Account['platform']
  time: string
  count: number
}
export type RuntimeData = {
  logs: DiagnosticLog[]
  talents: CollectedTalent[]
  records: InviteRecord[]
  tasks: Record<string, Task>
  collections: CollectionEvent[]
  accounts?: Account[]
  configs?: Record<string, InviteConfig>
}
export type LicenseState = {
  deviceId: string
  valid: boolean
  reason: string
  message: string
  hasCode: boolean
  activatedAt: string | null
  expiresAt: string | null
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
    | 'error'
  version?: string
  releaseNotes?: string
  percent?: number
  error?: string
  canInstall: boolean
}
export type DesktopEvent =
  | { type: 'update'; state: UpdateState }
  | { type: 'license'; state: LicenseState }
  | { type: 'runtime'; data: RuntimeData }
  | { type: 'account'; id: string; patch: Partial<Account> }
  | { type: 'capture'; id: string; ready: boolean }
  | { type: 'error'; message: string }
declare global {
  interface Window {
    desktop?: {
      getUpdateState: () => Promise<UpdateState>
      checkForUpdates: () => Promise<UpdateState>
      downloadUpdate: () => Promise<UpdateState>
      installUpdate: () => Promise<UpdateState>
      getLicenseState: () => Promise<LicenseState>
      verifyLicense: () => Promise<LicenseState>
      activateLicense: (
        code: string
      ) => Promise<{ valid: boolean; message?: string }>
      initialize: () => Promise<RuntimeData>
      exportLogs: () => Promise<boolean>
      clearLogs: (
        platform: Account['platform'] | 'all',
        accountId: string
      ) => Promise<void>
      clearTalents: (
        platform: Account['platform'],
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
      refreshAccount: (accountId: string) => Promise<void>
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
      stop: (accountId: string) => Promise<void>
      resolveRecord: (id: string, sent: boolean) => Promise<void>
      onEvent: (listener: (event: DesktopEvent) => void) => () => void
    }
  }
}
export type DesktopBridge = NonNullable<Window['desktop']>
export const desktop: DesktopBridge | undefined = isTauri()
  ? createDesktopBridge()
  : undefined
