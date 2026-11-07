/**
 * AI module map
 * Purpose: keep the maintained video extension on the desktop application's version.
 * Entry: Tauri development/build hooks run this file; extension packaging imports it.
 * Flow: package.json owns the version, copied into browser-extension/manifest.json
 * before source loading or resource staging. Unchanged versions do not rewrite the file.
 * Boundary: only the source manifest changes; no browser profiles or running workers.
 */

import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')

export async function syncVideoExtensionVersion() {
  const { version } = JSON.parse(
    await readFile(path.join(root, 'package.json'), 'utf8')
  )
  const file = path.join(root, 'browser-extension/manifest.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  if (manifest.version === version) return
  manifest.version = version
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n')
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await syncVideoExtensionVersion()
}
