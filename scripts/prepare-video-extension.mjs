/**
 * AI module map
 * Purpose: stage the maintained Chrome extension as native package resources.
 * Entry: package.mjs calls prepareVideoExtension before Tauri; standalone packaging
 * supplies its own staging directory and disables source-manifest synchronization.
 * Flow: synchronize the extension version from package.json, copy runtime files
 * into ignored .work, minify owned scripts, hash the staged paths/content, and return
 * Tauri resource mappings consumed by browser_extension.rs in installed builds.
 * Ownership: browser-extension/ is the only editable source; .work is generated.
 * Invariants: preserve script paths, imports, page bridges, console diagnostics,
 * vendor files and licenses. No source maps, maintenance docs or local secrets.
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { transform } from 'esbuild'
import { syncVideoExtensionVersion } from './sync-video-extension-version.mjs'

const root = path.resolve(import.meta.dirname, '..')

export async function prepareVideoExtension({
  destination = path.join(root, '.work/video-extension'),
  syncSourceVersion = true,
} = {}) {
  const source = path.join(root, 'browser-extension')
  // Native packaging retains its source-version hook; standalone builds only change the copy.
  if (syncSourceVersion) await syncVideoExtensionVersion()
  await mkdir(path.dirname(destination), { recursive: true })
  await rm(destination, { recursive: true, force: true })
  await cp(source, destination, {
    recursive: true,
    filter: (entry) => {
      const name = path.basename(entry)
      if (name.startsWith('.') || /\.(?:map|pem|key|p12|pfx)$/i.test(name)) return false
      const license = name === 'THIRD_PARTY_NOTICES.md'
        || /^(?:license|copying|notice)/i.test(name) || /\.LEGAL(?:\.|$)/i.test(name)
        || path.relative(source, entry).split(path.sep).includes('licenses')
      return !/\.md$/i.test(name) || license
    },
  })
  // Standalone releases only update the staged manifest, never maintained source.
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const manifestPath = path.join(destination, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = version
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  await minifyOwnedScripts(destination)
  const hash = createHash('sha256')
  await hashDirectory(destination, '', hash)
  const fingerprint = destination + '.sha256'
  await writeFile(fingerprint, hash.digest('hex') + '\n')
  return {
    [destination + path.sep]: 'video-extension/',
    [fingerprint]: 'video-extension.sha256',
  }
}

async function minifyOwnedScripts(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'vendor' && entry.name !== 'licenses') await minifyOwnedScripts(file)
    } else if (entry.name.endsWith('.js')) {
      // MAIN-world func injections lose the worker's scope. Keep modern syntax
      // native and avoid name-preservation helpers or cross-file transformations.
      const result = await transform(await readFile(file, 'utf8'), {
        target: 'chrome116',
        minifyWhitespace: true,
        minifyIdentifiers: true,
        minifySyntax: false,
        keepNames: false,
        sourcemap: false,
        legalComments: 'inline',
      })
      await writeFile(file, result.code)
    }
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
