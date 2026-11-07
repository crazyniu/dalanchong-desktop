/**
 * AI module map
 * Purpose: stage the maintained Chrome extension as native package resources.
 * Entry: package.mjs calls prepareVideoExtension before invoking the Tauri CLI.
 * Flow: synchronize the extension version from package.json, copy browser-extension
 * into ignored .work, hash its paths/content, and return
 * Tauri resource mappings consumed by browser_extension.rs in installed builds.
 * Ownership: browser-extension/ is the only editable source; .work is generated.
 * Invariants: stage the synchronized manifest, vendor files and licenses intact. Never copy a browser
 * profile, local secrets or unrelated project files into the installer.
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { syncVideoExtensionVersion } from './sync-video-extension-version.mjs'

const root = path.resolve(import.meta.dirname, '..')

export async function prepareVideoExtension() {
  const source = path.join(root, 'browser-extension')
  // Version synchronization must precede copying and fingerprinting the resources.
  await syncVideoExtensionVersion()
  const destination = path.join(root, '.work/video-extension')
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => !path.basename(entry).startsWith('.'),
  })
  const hash = createHash('sha256')
  await hashDirectory(destination, '', hash)
  const fingerprint = path.join(root, '.work/video-extension.sha256')
  await writeFile(fingerprint, hash.digest('hex') + '\n')
  return {
    [destination + path.sep]: 'video-extension/',
    [fingerprint]: 'video-extension.sha256',
  }
}

async function hashDirectory(directory, relative, hash) {
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  for (const entry of entries) {
    const file = path.join(directory, entry.name)
    const name = relative + entry.name
    if (entry.isDirectory()) {
      await hashDirectory(file, name + '/', hash)
    } else {
      const bytes = await readFile(file)
      hash.update(name + '\0' + bytes.length + '\0')
      hash.update(bytes)
    }
  }
}
