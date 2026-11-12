/**
 * AI module map
 * Purpose: expose the native operating-system gate for local video montage.
 * Entry: AppShell uses useMacVideoMontage; the route awaits isMacVideoMontage.
 * Flow: cache one main-WebView IPC request and share its result across both callers.
 * Invariants: browser preview and non-Mac desktops do not show the feature. Native
 * filesystem commands enforce their own platform, caller, and license boundaries.
 */

import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { toast } from 'sonner'
import { desktop } from '@/features/commerce/desktop'

let platform: Promise<boolean> | undefined

export function isMacVideoMontage(): Promise<boolean> {
  if (!desktop) return Promise.resolve(false)
  platform ??= invoke<string>('video_montage_platform').then((os) => os === 'macos')
  return platform
}

export function useMacVideoMontage(): boolean {
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let mounted = true
    void isMacVideoMontage()
      .then((value) => { if (mounted) setSupported(value) })
      .catch((error: unknown) => { if (mounted) toast.error(String(error)) })
    return () => { mounted = false }
  }, [])
  return supported
}
