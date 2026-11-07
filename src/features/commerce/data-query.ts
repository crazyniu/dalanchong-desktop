/**
 * AI module map
 * Purpose: bind mounted commerce views to native database pages and aggregates.
 * Flow: serialized request identity and durable-data revisions schedule one query;
 * while it runs, newer requests replace the pending request instead of stacking IPC.
 * Revisions schedule work directly; React only rerenders when query results arrive.
 * State: each hook owns its in-flight/pending work and the last displayed result.
 * Disabled/unmounted views release their revision subscription and pending work.
 * Invariants: responses cannot publish for a different request identity or after unmount.
 * Same-query results remain usable during revision churn, followed by the latest refresh;
 * changed query identities show the existing loading state.
 */
import { useEffect, useRef, useState } from 'react'
import { desktop } from './desktop'
import { useCommerce } from './store'
import type { TalentFilters } from './collection-filters'
import type { CollectedTalent, DiagnosticLog, InviteRecord, Platform } from './types'

export type DataQuery = { kind: string; [key: string]: unknown }
export type TalentScope = {
  platform: Platform
  accountId: string
  query?: string
  filters?: TalentFilters
  ids?: string[]
}
export type RecordsScope = {
  platform?: Platform | 'all'
  accountId?: string
  since?: string
}
export type TalentsPage = {
  rows: CollectedTalent[]
  total: number
  accountTotal: number
  page: number
  latestRecords: InviteRecord[]
  sources: string[]
  columns: string[]
}
export type RecordsPage = { rows: InviteRecord[]; total: number; page: number }
export type LogsPage = { rows: DiagnosticLog[]; total: number; page: number }
type PendingQuery = { key: string }

export function useDataQuery<T>(request: DataQuery, enabled = true) {
  const key = JSON.stringify(request)
  const [result, setResult] = useState<{ key: string; data?: T; error: string }>()
  const queue = useRef<{
    running: boolean
    pending?: PendingQuery
    current?: PendingQuery
  }>({ running: false })
  useEffect(() => {
    if (!desktop || !enabled) return
    const backend = desktop
    const currentQueue = queue.current
    const pending = { key }
    currentQueue.current = pending
    const refresh = () => {
      currentQueue.pending = pending
      if (currentQueue.running) return
      currentQueue.running = true
      void (async () => {
        while (currentQueue.pending) {
          const current = currentQueue.pending
          currentQueue.pending = undefined
          try {
            const data = await backend.queryData<T>(JSON.parse(current.key))
            if (currentQueue.current?.key === current.key)
              setResult({ key: current.key, data, error: '' })
          } catch (error) {
            if (currentQueue.current?.key === current.key)
              setResult({ key: current.key, error: String(error) })
          }
        }
        currentQueue.running = false
      })()
    }
    const unsubscribe = useCommerce.subscribe((state, previous) => {
      if (state.dataRevision !== previous.dataRevision) refresh()
    })
    refresh()
    return () => {
      unsubscribe()
      if (currentQueue.current === pending) currentQueue.current = undefined
      if (currentQueue.pending === pending) currentQueue.pending = undefined
    }
  }, [key, enabled])
  const current = enabled && result?.key === key ? result : undefined
  return {
    data: current?.data,
    loading: Boolean(desktop && enabled && !current),
    error: current?.error || '',
  }
}
