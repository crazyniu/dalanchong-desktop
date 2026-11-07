/**
 * AI module map
 * Purpose: wrap Radix Label with shared typography and disabled-state styling.
 * Entry: Label passes htmlFor and native primitive props to preserve input association.
 * Flow: the caller supplies control IDs and text.
 * Invariant: retain semantic label/control linking; this file has no field state or validation.
 */

'use client'

import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@/lib/utils'

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot='label'
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export { Label }
