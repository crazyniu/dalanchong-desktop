import { toast } from 'sonner'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { desktop, type CollectionEvent } from './desktop'
import type {
  Account,
  Candidate,
  CollectedTalent,
  DiagnosticLog,
  DiagnosticResponse,
  Filters,
  InviteConfig,
  InviteRecord,
  Platform,
  Task,
} from './types'

export const defaults: InviteConfig = {
  products: desktop ? '' : '22987672624321',
  message: desktop
    ? ''
    : '您好，想邀请您合作店铺的家居好物。可提供样品和专属佣金，欢迎联系，期待合作！',
  phone: '',
  wechat: desktop ? '' : 'shop_demo',
  interval: 1000,
  maxInvites: null,
}
export const defaultFilters: Filters = {
  keyword: '',
  category: 'all',
  fans: 'all',
  level: 'all',
}
const shops: Account[] = [
  {
    id: 'ks-1',
    platform: 'kuaishou',
    name: '清禾家居旗舰店',
    shopId: 'KS882160',
    sessionId: 'persist:kuaishou:ks-1',
    status: 'online',
    savedAt: new Date().toISOString(),
    quota: 286,
    limit: 500,
  },
  {
    id: 'ks-2',
    platform: 'kuaishou',
    name: '田野农资专营店',
    shopId: 'KS739205',
    sessionId: 'persist:kuaishou:ks-2',
    status: 'online',
    savedAt: new Date().toISOString(),
    quota: 412,
    limit: 500,
  },
  {
    id: 'dy-1',
    platform: 'douyin',
    name: '清禾生活好物店',
    shopId: 'DY618329',
    sessionId: 'persist:douyin:dy-1',
    status: 'online',
    savedAt: new Date().toISOString(),
    quota: 168,
    limit: 300,
  },
  {
    id: 'dy-2',
    platform: 'douyin',
    name: '绿野家清专营店',
    shopId: 'DY905172',
    sessionId: 'persist:douyin:dy-2',
    status: 'expired',
    savedAt: new Date(Date.now() - 86400000 * 6).toISOString(),
    quota: 74,
    limit: 100,
  },
]
const names = [
  '小满的家居日记',
  '阿雅爱生活',
  '田园好物推荐',
  '北北的生活清单',
  '一只小橙子',
  '周姐优选',
  '林间好物',
  '大鹏说农资',
  '小安的收纳间',
  '佳佳日用百货',
  '小鹿生活馆',
  '阿诚好物分享',
  '小禾种植日记',
  '爱生活的糖糖',
  '刘姐家清好物',
  '暖暖的小院',
  '简一好物',
  '老张农技',
  '安妮精选',
  '乐享家居',
]
export function candidates(platform: Platform): Candidate[] {
  return Array.from({ length: 60 }, (_, i) => ({
    id: `${platform === 'kuaishou' ? 'k' : 'd'}${28061000 + i}`,
    name:
      names[i % names.length] + (i >= 20 ? ` ${Math.floor(i / 20) + 1}` : ''),
    fans: 8600 + ((i * 17371) % 650000),
    category: i % 3 === 0 ? '农资园艺' : '家居日用',
    level: ['LV1', 'LV2', 'LV3', 'LV4'][i % 4],
    source: i % 3 === 0 ? '灭鼠防虫 · 农资园艺' : '家居清洁 · 日用百货',
  }))
}
export function filterCandidates(platform: Platform, filters: Filters) {
  return candidates(platform).filter(
    (c) =>
      (!filters.keyword || (c.name + c.source).includes(filters.keyword)) &&
      (filters.category === 'all' || c.category === filters.category) &&
      (filters.level === 'all' || c.level === filters.level) &&
      (filters.fans === 'all' ||
        (filters.fans === '10w' ? c.fans >= 100000 : c.fans < 100000))
  )
}
function seedRecords(): InviteRecord[] {
  const result: InviteRecord[] = []
  for (let day = 0; day < 14; day++)
    for (const [a, account] of shops.entries()) {
      const count = 16 + ((day * 7 + a * 11) % 32)
      for (let i = 0; i < count; i++) {
        const time = new Date()
        time.setDate(time.getDate() - day)
        time.setHours(8 + (i % 9), (i * 7) % 60, 0, 0)
        if (time.getTime() > Date.now()) time.setTime(Date.now() - i * 61000)
        const status =
          i % 23 === 0
            ? 'review'
            : i % 17 === 0
              ? 'failed'
              : i % 7 === 0
                ? 'skipped'
                : 'success'
        result.push({
          id: `history-${a}-${day}-${i}`,
          accountId: account.id,
          platform: account.platform,
          talentId: `history-${day}-${i}`,
          name: names[i % names.length],
          time: time.toISOString(),
          status,
          source: i % 3 === 0 ? '灭鼠防虫' : '家居日用',
          products: defaults.products,
          message: defaults.message,
          note:
            status === 'review'
              ? '未收到最终发送结果，请核实平台记录。'
              : status === 'failed'
                ? '平台返回：商品不在达人可带范围内。'
                : status === 'skipped'
                  ? '近期已邀约'
                  : '',
        })
      }
    }
  return result.sort((a, b) => b.time.localeCompare(a.time))
}
function seedCollections(): CollectionEvent[] {
  const grouped = new Map<string, CollectionEvent>()
  for (const r of seedRecords()) {
    const key = r.accountId + r.time.slice(0, 10)
    const previous = grouped.get(key)
    if (previous) previous.count++
    else
      grouped.set(key, {
        id: key,
        accountId: r.accountId,
        platform: r.platform,
        time: r.time,
        count: 1,
      })
  }
  return [...grouped.values()]
}
type CommerceState = {
  accounts: Account[]
  records: InviteRecord[]
  logs: DiagnosticLog[]
  talents: CollectedTalent[]
  collections: CollectionEvent[]
  captured: Record<string, boolean>
  configs: Record<string, InviteConfig>
  filters: Record<string, Filters>
  tasks: Record<string, Task>
  selected: Record<Platform, string>
  selectAccount: (platform: Platform, id: string) => void
  saveConfig: (id: string, config: InviteConfig) => void
  saveFilters: (id: string, filters: Filters) => void
  addAccount: (platform: Platform, name: string) => string
  login: (id: string) => void
  removeAccount: (id: string) => Promise<void>
  resolveRecord: (id: string, sent: boolean) => Promise<void>
  clearLogs: (platform: Platform | 'all', accountId: string) => Promise<void>
  clearTalents: (platform: Platform, ids?: string[]) => Promise<void>
  clearRecords: (ids: string[]) => Promise<void>
}
export const useCommerce = create<CommerceState>()(
  persist(
    (set, get) => ({
      accounts: desktop ? [] : shops,
      records: desktop ? [] : seedRecords(),
      collections: desktop ? [] : seedCollections(),
      talents: [],
      logs: [],
      captured: {},
      configs: {},
      filters: {},
      tasks: {},
      selected: {
        kuaishou: desktop ? '' : 'ks-1',
        douyin: desktop ? '' : 'dy-1',
      },
      selectAccount: (platform, id) =>
        set((s) => ({ selected: { ...s.selected, [platform]: id } })),
      saveConfig: (id, config) =>
        set((s) => ({ configs: { ...s.configs, [id]: config } })),
      saveFilters: (id, filters) =>
        set((s) => ({ filters: { ...s.filters, [id]: filters } })),
      addAccount: (platform, name) => {
        const id = crypto.randomUUID()
        set((s) => ({
          accounts: [
            ...s.accounts,
            {
              id,
              platform,
              name,
              shopId: '待登录',
              sessionId: `persist:${platform}:${id}`,
              status: 'offline',
              savedAt: '',
              quota: 0,
              limit: 0,
            },
          ],
        }))
        return id
      },
      login: (id) =>
        set((s) => ({
          accounts: s.accounts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: 'online',
                  savedAt: new Date().toISOString(),
                  shopId:
                    a.shopId === '待登录' ? `DEMO${id.slice(0, 6)}` : a.shopId,
                  quota: a.limit ? a.quota : 300,
                  limit: a.limit || 300,
                }
              : a
          ),
        })),
      removeAccount: async (id) => {
        const a = get().accounts.find((a) => a.id === id)!
        if (desktop) await desktop.removeAccount(id, a.platform)
        else stopDemo(id)
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          selected: {
            ...s.selected,
            [a.platform]:
              s.selected[a.platform] === id
                ? s.accounts.find(
                    (x) => x.platform === a.platform && x.id !== id
                  )?.id || ''
                : s.selected[a.platform],
          },
        }))
      },
      clearLogs: async (platform, accountId) => {
        if (desktop) return desktop.clearLogs(platform, accountId)
        set((s) => ({
          logs: s.logs.filter(
            (log) =>
              !(
                (platform === 'all' ||
                  !log.platform ||
                  log.platform === platform) &&
                (accountId === 'all' || log.accountId === accountId)
              )
          ),
          tasks: Object.fromEntries(
            Object.entries(s.tasks).map(([id, task]) => [
              id,
              (accountId === 'all' || id === accountId) &&
              (platform === 'all' ||
                s.accounts.find((a) => a.id === id)?.platform === platform)
                ? { ...task, logs: [] }
                : task,
            ])
          ),
        }))
      },
      clearTalents: async (platform, ids) => {
        if (desktop) return desktop.clearTalents(platform, ids)
        const state = get()
        if (
          state.accounts.some(
            (a) =>
              a.platform === platform && state.tasks[a.id]?.status === 'running'
          )
        )
          throw Error('请先停止此平台的采集或邀约任务')
        const selected = new Set(ids)
        set((s) => ({
          talents: s.talents.filter(
            (talent) =>
              talent.platform !== platform ||
              (ids !== undefined && !selected.has(talent.id))
          ),
        }))
      },
      clearRecords: async (ids) => {
        if (desktop) return desktop.clearRecords(ids)
        const state = get()
        if (
          state.records.some(
            (r) =>
              ids.includes(r.id) &&
              state.tasks[r.accountId]?.status === 'running'
          )
        )
          throw Error('请先停止相关账号的任务')
        set((s) => ({
          records: s.records.filter((record) => !ids.includes(record.id)),
        }))
      },
      resolveRecord: async (id, sent) => {
        if (desktop) {
          await desktop.resolveRecord(id, sent)
          return
        }
        set((s) => ({
          records: s.records.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: sent ? 'success' : 'skipped',
                  note: sent ? '人工确认已邀约' : '人工确认未邀约',
                  resolution: new Date().toISOString(),
                }
              : r
          ),
        }))
      },
    }),
    {
      name: desktop
        ? 'ecommerce-assistant-local-v1'
        : 'ecommerce-assistant-demo-v1',
      partialize: (s) => ({
        accounts: s.accounts,
        ...(!desktop
          ? {
              records: s.records,
              logs: s.logs,
              talents: s.talents,
              collections: s.collections,
            }
          : {}),
        configs: s.configs,
        filters: s.filters,
        selected: s.selected,
      }),
    }
  )
)

const timers = new Map<string, ReturnType<typeof setInterval>>()
export function stopDemo(id: string) {
  clearInterval(timers.get(id))
  timers.delete(id)
  useCommerce.setState((s) => ({
    tasks: s.tasks[id]
      ? {
          ...s.tasks,
          [id]: {
            ...s.tasks[id],
            status: 'stopped',
            current: '已停止',
          },
        }
      : s.tasks,
  }))
}
function demoTask(
  account: Account,
  kind: 'collect' | 'invite',
  total: number
): Task {
  return {
    accountId: account.id,
    kind,
    startedAt: new Date().toISOString(),
    logs: [],
    status: 'running',
    total,
    collected: 0,
    processed: 0,
    success: 0,
    skipped: 0,
    failed: 0,
    review: 0,
    current: kind === 'collect' ? '正在采集达人' : '准备邀约',
    filters: { ...defaultFilters },
  }
}
export function collectDemo(account: Account, filters: Filters) {
  if (timers.has(account.id)) throw Error('该账号已有任务正在运行')
  if (account.status !== 'online') throw Error('请先登录采集账号')
  const list = filterCandidates(account.platform, filters)
  const task = {
    ...demoTask(account, 'collect', list.length),
    filters: { ...filters },
  }
  const event: CollectionEvent = {
    id: crypto.randomUUID(),
    accountId: account.id,
    platform: account.platform,
    time: new Date().toISOString(),
    count: 0,
  }
  useCommerce.setState((s) => ({
    tasks: { ...s.tasks, [account.id]: task },
    collections: [...s.collections, event],
  }))
  const timer = setInterval(() => {
    const current = useCommerce.getState().tasks[account.id]
    const end = Math.min(list.length, current.collected + 20)
    const batch: CollectedTalent[] = list
      .slice(current.collected, end)
      .map((c) => ({
        id: c.id,
        name: c.name,
        fans: c.fans,
        source: c.source,
        platform: account.platform,
        sourceAccountId: account.id,
        collectedAt: new Date().toISOString(),
      }))
    const done = end === list.length
    if (done) {
      clearInterval(timer)
      timers.delete(account.id)
    }
    useCommerce.setState((s) => {
      const pool = new Map(s.talents.map((t) => [t.platform + ':' + t.id, t]))
      for (const t of batch) pool.set(t.platform + ':' + t.id, t)
      return {
        talents: [...pool.values()],
        collections: s.collections.map((c) =>
          c.id === event.id ? { ...c, count: end } : c
        ),
        tasks: {
          ...s.tasks,
          [account.id]: {
            ...current,
            collected: end,
            processed: end,
            status: done ? 'done' : 'running',
            current: done
              ? `采集完成，共 ${end} 位达人`
              : `已采集 ${end} 位达人`,
          },
        },
      }
    })
  }, 450)
  timers.set(account.id, timer)
}
function logDemoInvite(
  accountId: string,
  message: string,
  response?: DiagnosticResponse
) {
  useCommerce.setState((s) => {
    const task = s.tasks[accountId]
    const entry: DiagnosticLog = {
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      accountId,
      platform: s.accounts.find((a) => a.id === accountId)!.platform,
      taskId: task.startedAt,
      kind: 'invite',
      level: 'error',
      message,
      response,
    }
    return {
      logs: [...s.logs, entry].slice(-1000),
      tasks: {
        ...s.tasks,
        [accountId]: {
          ...task,
          logs: [...(task.logs || []), entry].slice(-200),
        },
      },
    }
  })
}
export function startDemo(
  account: Account,
  talentIds: string[],
  config: InviteConfig
) {
  if (timers.has(account.id)) throw Error('该账号已有任务正在运行')
  if (account.status !== 'online') throw Error('请先登录邀约账号')
  const selected = new Set(talentIds)
  const list = useCommerce
    .getState()
    .talents.filter(
      (t) => t.platform === account.platform && selected.has(t.id)
    )
    .slice(0, config.maxInvites ?? undefined)
  if (!list.length) throw Error('请先从采集列表选择达人')
  const task = demoTask(account, 'invite', list.length)
  useCommerce.setState((s) => ({ tasks: { ...s.tasks, [account.id]: task } }))
  const timer = setInterval(() => {
    const state = useCommerce.getState()
    const current = state.tasks[account.id]
    if (
      current.processed >= list.length ||
      state.accounts.find((a) => a.id === account.id)!.quota === 0
    ) {
      clearInterval(timer)
      timers.delete(account.id)
      useCommerce.setState((s) => ({
        tasks: {
          ...s.tasks,
          [account.id]: {
            ...current,
            status: 'done',
            current:
              current.processed >= list.length
                ? '本次邀约已完成'
                : '邀约额度已用完',
          },
        },
      }))
      return
    }
    const candidate = list[current.processed]
    const duplicate = state.records.some(
      (r) =>
        r.accountId === account.id &&
        r.talentId === candidate.id &&
        (r.status === 'review' ||
          r.status === 'sending' ||
          (r.status === 'success' &&
            (account.platform === 'douyin' ||
              Date.now() - Date.parse(r.resolution || r.time) < 7 * 86400000)))
    )
    const status = duplicate
      ? 'skipped'
      : current.processed === 7
        ? 'review'
        : 'success'
    const record: InviteRecord = {
      id: crypto.randomUUID(),
      accountId: account.id,
      platform: account.platform,
      talentId: candidate.id,
      name: candidate.name,
      time: new Date().toISOString(),
      status,
      source: candidate.source,
      products: config.products,
      message: config.message,
      note: duplicate
        ? '近期已邀约或结果待核实'
        : status === 'review'
          ? '未收到最终发送结果，请核实平台记录。'
          : '',
    }
    const stopped = status === 'review'
    if (stopped) {
      record.response = {
        path: '/demo/invite',
        method: 'POST',
        status: 504,
        message: '演示：未收到最终发送结果',
      }
      clearInterval(timer)
      timers.delete(account.id)
    }
    useCommerce.setState((s) => ({
      records: [record, ...s.records],
      accounts: s.accounts.map((a) =>
        a.id === account.id && status === 'success'
          ? { ...a, quota: a.quota - 1 }
          : a
      ),
      tasks: {
        ...s.tasks,
        [account.id]: {
          ...current,
          processed: current.processed + 1,
          [status]: current[status] + 1,
          status: stopped ? 'stopped' : 'running',
          current: stopped ? '结果待核实，已停止' : candidate.name,
        },
      },
    }))
    if (status === 'review')
      logDemoInvite(
        account.id,
        `${candidate.name} · ${record.note}`,
        record.response
      )
  }, config.interval)
  timers.set(account.id, timer)
}

if (desktop) {
  desktop.onEvent((event) => {
    if (event.type === 'runtime')
      useCommerce.setState({ ...event.data, logs: event.data.logs ?? [] })
    if (event.type === 'account')
      useCommerce.setState((s) => ({
        accounts: s.accounts.map((a) =>
          a.id === event.id ? { ...a, ...event.patch } : a
        ),
      }))
    if (event.type === 'capture')
      useCommerce.setState((s) => ({
        captured: { ...s.captured, [event.id]: event.ready },
      }))
    if (event.type === 'error') toast.error(event.message)
  })
}
