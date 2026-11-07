/**
 * AI module map
 * Purpose: declare the TypeScript contract for the JavaScript runtime factory.
 * Entry: createRuntime accepts Tauri invoke/listen and returns Window.desktop.
 * Related: commerce/desktop.ts defines the shared bridge interface; runtime.mjs implements it.
 * initialize returns complete RuntimeData; runtime events carry partial domain updates,
 * while task events carry one account/kind task and preserve the other UI task references.
 * Task maps use accountId:kind keys; stop(accountId, kind?) cancels one kind or both.
 * Invariant: this file declares types only. Keep declarations aligned with actual methods;
 * adding a type must never imply that native permissions or an implementation already exist.
 */

import type { invoke } from '@tauri-apps/api/core'
import type { listen } from '@tauri-apps/api/event'
import type {} from '../features/commerce/desktop'

export function createRuntime(
  call: typeof invoke,
  subscribe: typeof listen
): NonNullable<Window['desktop']>
