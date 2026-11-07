/**
 * AI module map
 * Purpose: render horizontal/vertical Radix separators with theme border tokens.
 * Entry: Separator forwards orientation/decorative and primitive props.
 * Flow: orientation selects dimensions; the caller decides whether the separator is semantic.
 * Invariant: retain accessibility intent and avoid adding unrelated layout state.
 */

import * as React from 'react'
import * as SeparatorPrimitive from '@radix-ui/react-separator'
import { cn } from '@/lib/utils'

function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot='separator'
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px',
        className
      )}
      {...props}
    />
  )
}

export { Separator }
