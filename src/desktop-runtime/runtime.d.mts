import type { invoke } from '@tauri-apps/api/core'
import type { listen } from '@tauri-apps/api/event'
import type {} from '../features/commerce/desktop'

export function createRuntime(
  call: typeof invoke,
  subscribe: typeof listen
): NonNullable<Window['desktop']>
