/**
 * AI module map
 * Purpose: show browser download/install progress as a non-modal task card.
 * Entry: log-overlay.tsx renders the shared shop-browser state above native pages.
 * Flow: native byte counts and stages determine the status/progress; failed or ready
 * cards may be dismissed through main. This component never starts or cancels a job.
 * Boundary: no backdrop, focus trap or page-local lifecycle; invitation feedback can
 * share the same native overlay stack without covering the rest of the application.
 */

import { LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { BrowserInstallState } from './shop-browser'

const labels = {
  downloading: '正在下载浏览器',
  verifying: '正在校验浏览器',
  installing: '正在安装浏览器',
  ready: '正在打开浏览器',
}

export function BrowserInstallProgress({ state, onDismiss }: {
  state: BrowserInstallState
  onDismiss: () => void
}) {
  const percent = state.total ? Math.min(100, state.downloaded / state.total * 100) : null
  return (
    <section
      aria-label='浏览器安装进度'
      data-slot='browser-install-progress'
      className='rounded-xl bg-background text-foreground shadow-[0_8px_32px_-8px_rgb(15_23_42/0.3)]'
    >
      <div className='flex items-center gap-2 px-4 pt-3'>
        {!state.error && <LoaderCircle className='size-4 shrink-0 motion-safe:animate-spin' />}
        <h3 className='text-sm font-semibold' aria-live='polite'>
          {state.error ? '浏览器打开失败' : labels[state.stage]}
        </h3>
        {state.error && (
          <Button className='ml-auto size-7' variant='ghost' size='icon' onClick={onDismiss} aria-label='关闭浏览器错误提示'>
            <X className='size-4' />
          </Button>
        )}
      </div>
      <div className='space-y-2 px-4 pt-2 pb-4'>
        {state.error ? (
          <p className='max-h-28 overflow-y-auto break-words text-sm text-destructive' role='alert'>{state.error}</p>
        ) : state.stage === 'downloading' && (
          <>
            {percent !== null && <Progress value={percent} className='h-1.5' aria-label='浏览器下载进度' />}
            <div className='flex justify-between gap-3 text-sm text-muted-foreground tabular-nums'>
              <span>{(state.downloaded / 1048576).toFixed(1)} MB{state.total ? ` / ${(state.total / 1048576).toFixed(1)} MB` : ''}</span>
              {percent !== null && <span>{Math.floor(percent)}%</span>}
            </div>
          </>
        )}
      </div>
    </section>
  )
}
