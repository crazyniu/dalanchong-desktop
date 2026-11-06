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
type DesktopEvent =
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
      prepareAccount: (
        account: Pick<Account, 'id' | 'platform'>
      ) => Promise<void>
      bindGuest: (accountId: string, guestId: number) => Promise<void>
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
export const desktop = window.desktop
