export function exportRecords(rows: object[], filename: string) {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  const text =
    '\uFEFF' +
    [
      cols,
      ...rows.map((r) => cols.map((c) => (r as Record<string, unknown>)[c])),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n')
  const url = URL.createObjectURL(
    new Blob([text], { type: 'text/csv;charset=utf-8' })
  )
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
export const formatTime = (time: string) =>
  new Date(time).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
