/**
 * AI module map
 * Purpose: display and copy the sanitized API response saved with a task or invitation.
 * Entry: ResponseDetails is shared by records, error logs, and the native collection log.
 * Flow: format complete JSON bodies once; preserve plain or truncated text and copy
 * only persisted metadata. This presentation module never imports the commerce store
 * or desktop runtime, so the native log child does not create a second business bridge.
 */

import { useMemo } from 'react'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { DiagnosticResponse } from './types'

function formatResponseBody(body: unknown) {
  if (typeof body !== 'string') return JSON.stringify(body, null, 2)
  try {
    return JSON.stringify(JSON.parse(body), null, 2)
  } catch {
    // HTTP errors and stored truncation can contain text that is not complete JSON.
    return body
  }
}

export function ResponseDetails({
  response,
}: {
  response: DiagnosticResponse
}) {
  const bodyText = useMemo(() => formatResponseBody(response.body), [response.body])

  async function copyResponse() {
    const lines = [`接口：${response.path}`]
    if (response.method) lines.push(`请求方法：${response.method}`)
    if (response.status !== undefined) lines.push(`HTTP 状态：${response.status}`)
    if (response.code !== undefined) lines.push(`返回码：${response.code}`)
    if (response.message) lines.push(`消息：${response.message}`)
    if (response.requestId) lines.push(`请求 ID：${response.requestId}`)
    if (bodyText !== undefined) lines.push('', '返回正文：', bodyText)
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      toast.success('接口返回结果已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  return (
    <div className='min-w-0 space-y-3 rounded-lg border bg-muted/30 p-3 text-sm'>
      <div className='flex items-start gap-3'>
        <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
          {response.method && <Badge variant='outline'>{response.method}</Badge>}
          <code className='min-w-0 break-all'>{response.path}</code>
          {response.status !== undefined && (
            <Badge variant='secondary'>HTTP {response.status}</Badge>
          )}
          {response.code !== undefined && <span>返回码 {response.code}</span>}
        </div>
        <Button type='button' variant='ghost' size='sm' onClick={() => void copyResponse()} aria-label='复制接口返回结果'>
          <Copy />复制
        </Button>
      </div>
      {response.message && (
        <p className='break-words whitespace-pre-wrap'>{response.message}</p>
      )}
      {response.requestId && (
        <p className='break-all text-muted-foreground'>
          请求 ID：{response.requestId}
        </p>
      )}
      {bodyText !== undefined && (
        <pre className='max-h-80 overflow-auto rounded-md bg-background p-3 font-mono text-sm leading-5 break-all whitespace-pre-wrap'>
          {bodyText}
        </pre>
      )}
    </div>
  )
}

