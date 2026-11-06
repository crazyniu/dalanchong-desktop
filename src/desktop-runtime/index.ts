import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { createRuntime } from './runtime.mjs'

export function createDesktopBridge(): NonNullable<Window['desktop']> {
  return createRuntime(invoke, listen)
}
