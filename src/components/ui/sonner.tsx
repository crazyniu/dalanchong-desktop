/**
 * AI module map
 * Purpose: configure the global Sonner toast renderer with application theme tokens.
 * Entry: Toaster is mounted by main.tsx and accepts normal Sonner props.
 * Flow: useTheme supplies the theme; CSS variables align message backgrounds/text/borders.
 * Invariant: this renderer does not own persistent invitation progress, which belongs to
 * invite-progress.tsx; a toast must not become the authoritative result record.
 */

import { Toaster as Sonner, ToasterProps } from 'sonner'
import { useTheme } from '@/context/theme-provider'

export function Toaster({ ...props }: ToasterProps) {
  const { theme = 'system' } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps['theme']}
      className='toaster group [&_div[data-content]]:w-full'
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
        } as React.CSSProperties
      }
      {...props}
    />
  )
}
