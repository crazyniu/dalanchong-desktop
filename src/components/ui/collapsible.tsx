/**
 * AI module map
 * Purpose: expose Radix collapsible root, trigger, and content with shared data slots.
 * Entry: Collapsible, CollapsibleTrigger, and CollapsibleContent forward primitive props.
 * Flow: callers own controlled state or allow Radix's local state; CSS consumes data-state.
 * Invariant: hiding content is presentation only and does not cancel underlying tasks.
 */

import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'

function Collapsible({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot='collapsible' {...props} />
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot='collapsible-trigger'
      {...props}
    />
  )
}

function CollapsibleContent({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot='collapsible-content'
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
