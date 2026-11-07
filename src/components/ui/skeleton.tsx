/**
 * AI module map
 * Purpose: render a themed placeholder while an owning view loads content.
 * Entry: Skeleton forwards div props and caller dimensions/classes.
 * Flow: CSS supplies the placeholder animation; the caller decides when to replace it.
 * Invariant: no timers, fake data, or readiness state should be introduced here.
 */

import { cn } from '@/lib/utils'

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot='skeleton'
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}

export { Skeleton }
