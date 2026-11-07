/**
 * AI module map
 * Purpose: render a reusable horizontally and vertically centered loading indication.
 * Entry: LoadingState accepts a required label plus optional className/children.
 * Flow: render an aria-live status, motion-aware spinner, and optional related controls.
 * Invariant: readiness is determined by the caller; this component owns no timer or request.
 * Keep centered layout for activation, page loading, updates, and other loading surfaces.
 */

import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingState({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      role='status'
      aria-live='polite'
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground',
        className
      )}
    >
      <LoaderCircle
        aria-hidden='true'
        className='size-6 shrink-0 motion-safe:animate-spin'
      />
      <span>{label}</span>
      {children}
    </div>
  )
}
