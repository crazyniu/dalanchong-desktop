/**
 * AI module map
 * Purpose: generate platform icon assets from assets/icons/white-master.png.
 * Entry: run as a Node script only when icon regeneration is explicitly requested.
 * Flow: use macOS sips to resize PNGs, assemble ICNS/ICO outputs, and copy web/Tauri icons.
 * Side effects: writes icon assets and invokes native image tools; it is not a read-only
 * inspection utility. Preserve the source master and existing application icon references.
 */

import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const icons = path.join(root, 'assets/icons')
const iconset = path.join(icons, 'app.iconset')
await mkdir(iconset, { recursive: true })
function resize(source, size, target) {
  execFileSync(
    'sips',
    ['-z', String(size), String(size), source, '--out', target],
    { stdio: 'ignore' }
  )
}

resize(
  path.join(icons, 'white-master.png'),
  1024,
  path.join(icons, 'mac-1024.png')
)
resize(
  path.join(icons, 'white-master.png'),
  1024,
  path.join(icons, 'icon-1024.png')
)
for (const size of [16, 32, 128, 256, 512]) {
  resize(
    path.join(icons, 'mac-1024.png'),
    size,
    path.join(iconset, `icon_${size}x${size}.png`)
  )
  resize(
    path.join(icons, 'mac-1024.png'),
    size * 2,
    path.join(iconset, `icon_${size}x${size}@2x.png`)
  )
}
execFileSync('iconutil', [
  '-c',
  'icns',
  iconset,
  '-o',
  path.join(icons, 'app.icns'),
])

// PNG-compressed, 32-bit RGBA frames for modern Windows desktop applications.
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
const frames = []
for (const size of sizes) {
  const file = path.join(icons, `icon-${size}.png`)
  resize(path.join(icons, 'icon-1024.png'), size, file)
  frames.push(await readFile(file))
}
const header = Buffer.alloc(6 + 16 * frames.length)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(frames.length, 4)
let offset = header.length
frames.forEach((frame, index) => {
  const entry = 6 + index * 16
  header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index]
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(frame.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += frame.length
})
await writeFile(path.join(icons, 'app.ico'), Buffer.concat([header, ...frames]))
for (const publicDir of [path.join(root, 'public')]) {
  await mkdir(publicDir, { recursive: true })
  await cp(path.join(icons, 'icon-256.png'), path.join(publicDir, 'brand.png'))
  await cp(
    path.join(icons, 'original.png'),
    path.join(publicDir, 'brand-transparent.png')
  )
  await cp(path.join(icons, 'icon-64.png'), path.join(publicDir, 'favicon.png'))
}
console.log('Exported macOS ICNS, Windows ICO, PNG sizes and web branding.')

execFileSync(
  'pnpm',
  [
    'tauri',
    'icon',
    path.join(icons, 'icon-256.png'),
    '-o',
    path.join(icons, 'tauri'),
    '-p',
    '256',
  ],
  { cwd: root, stdio: 'inherit' }
)
