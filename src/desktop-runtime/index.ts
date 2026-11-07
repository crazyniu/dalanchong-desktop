/**
 * AI module map
 * Purpose: construct the production bridge by injecting Tauri invoke/listen into runtime.mjs.
 * Entry: createDesktopBridge is called by commerce/desktop.ts only inside Tauri.
 * Flow: transport injection keeps runtime orchestration separate from the native API.
 * Invariant: browser preview must not instantiate a native bridge or send real requests.
 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createRuntime } from './runtime.mjs'

export function createDesktopBridge(): NonNullable<Window['desktop']> {
  return createRuntime(invoke, listen)
}
