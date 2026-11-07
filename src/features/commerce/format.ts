/**
 * AI module map
 * Purpose: format record timestamps and save CSV exports for commerce tables.
 * Entry: exportRecords serializes object rows; formatTime/formatLogTime render local
 * zh-CN timestamps with shared minute/second formatters instead of per-cell instances.
 * Flow: use first-row keys as columns, quote/escape values, and prepend a UTF-8 BOM.
 * Desktop exports use the native save dialog through desktop.exportCsv; browser preview
 * uses a temporary Blob download. Callers await completion and own progress/result UI.
 * Result: false means empty rows or native dialog cancellation; errors reject. True means
 * the native file was written, or the browser preview download was requested.
 * Invariant: callers choose which rows and fields are exported. This helper neither
 * fetches hidden records nor persists permissions, platform state, or activation data.
 */

import { desktop } from './desktop'

export async function exportRecords(rows: object[], filename: string) {
  if (!rows.length) return false
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const lines = [cols.map(cell).join(',')]
  for (const row of rows) {
    lines.push(cols.map((column) => cell((row as Record<string, unknown>)[column])).join(','))
  }
  const text = '\uFEFF' + lines.join('\r\n')
  if (desktop) return desktop.exportCsv(filename, text)
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  return true
}
const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const logTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})
export const formatTime = (time: string) => timeFormat.format(new Date(time))
export const formatLogTime = (time: string) => logTimeFormat.format(new Date(time))
