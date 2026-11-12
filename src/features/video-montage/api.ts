/**
 * AI module map
 * Purpose: expose typed video-montage directory and processing commands to the main WebView.
 * Entry: the page reads state, starts/cancels a batch and picks/opens local directories.
 * Flow: Rust owns Mac availability, caller identity, licensing, encoder processes and snapshots.
 * Invariants: returned progress is native state; cancellation never requires a valid license.
 */

import { invoke } from '@tauri-apps/api/core'
import type { DirectoryKind, MontageSettings, MontageSnapshot, MontageVideo } from './types'

export function pickMontageDirectory(kind: DirectoryKind) {
  return invoke<string | null>('video_montage_pick_directory', { kind })
}

export function listMontageVideos(path: string) {
  return invoke<MontageVideo[]>('video_montage_list', { path })
}

export function openMontageDirectory(path: string) {
  return invoke<void>('video_montage_open_directory', { path })
}

export function getMontageSnapshot() {
  return invoke<MontageSnapshot>('video_montage_state')
}

export function startMontage(settings: MontageSettings, sourcePaths: string[], excludedPaths: string[]) {
  return invoke<MontageSnapshot>('video_montage_start', { settings, sourcePaths, excludedPaths })
}

export function cancelMontage() {
  return invoke<MontageSnapshot>('video_montage_cancel')
}
