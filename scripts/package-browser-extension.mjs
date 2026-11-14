/**
 * AI module map
 * Purpose: package the standalone extension from a minified staging copy.
 * Entry: node scripts/package-browser-extension.mjs [--zip-only] [--tag extension-vX.Y.Z].
 * Flow: package.json version -> staged runtime -> ZIP -> Chrome CRX3 with fixed RSA key.
 * Ownership: only .work/extension-release and dist-release/browser-extension are generated.
 * Invariants: source stays readable; no maps, secrets or license removal; no eval/bundling.
 * The private key is supplied by a file outside the stage, never generated or published.
 * Public key pins the ZIP identity; expected ID detects accidental signing-key rotation.
 */
import { createHash, createPrivateKey, createPublicKey } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { prepareVideoExtension } from './prepare-video-extension.mjs'

const root = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const zipOnly = args.includes('--zip-only')
const tagIndex = args.indexOf('--tag')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('Invalid Chrome extension version')
if (tagIndex >= 0 && args[tagIndex + 1] !== `extension-v${version}`) {
  throw new Error('Extension tag must match package.json version')
}
const stage = path.join(root, '.work/extension-release/extension')
const output = path.join(root, 'dist-release/browser-extension')
let publicKey
let extensionId
let keyPath
if (!zipOnly) {
  if (!process.env.EXTENSION_KEY_PATH || !/^[a-p]{32}$/.test(process.env.EXTENSION_ID || '')) {
    throw new Error('EXTENSION_KEY_PATH and fixed EXTENSION_ID are required for signed CRX packaging')
  }
  keyPath = path.resolve(process.env.EXTENSION_KEY_PATH)
  if (keyPath.startsWith(stage + path.sep) || keyPath.startsWith(output + path.sep)) {
    throw new Error('Signing key must be outside package directories')
  }
  const privateKey = createPrivateKey(await readFile(keyPath))
  if (privateKey.asymmetricKeyType !== 'rsa') throw new Error('CRX requires the existing RSA signing key')
  publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' })
  extensionId = createHash('sha256').update(publicKey).digest('hex').slice(0, 32)
    .replace(/[0-9a-f]/g, (digit) => String.fromCharCode(97 + parseInt(digit, 16)))
  if (extensionId !== process.env.EXTENSION_ID) throw new Error('Signing key does not match EXTENSION_ID')
}
await prepareVideoExtension({ destination: stage, syncSourceVersion: false })
if (publicKey) {
  const file = path.join(stage, 'manifest.json')
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.key = publicKey.toString('base64')
  await writeFile(file, JSON.stringify(manifest, null, 2) + '\n')
}
await rm(output, { recursive: true, force: true })
await mkdir(output, { recursive: true })
const basename = `dalanchong-extension-${version}`
const names = [`${basename}.zip`]
execFileSync('zip', ['-qr', path.join(output, names[0]), '.'], { cwd: stage, stdio: 'inherit' })
if (!zipOnly) {
  await rm(stage + '.crx', { force: true })
  execFileSync(process.env.CHROME_PATH || 'google-chrome', [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    `--user-data-dir=${path.join(root, '.work/extension-release/chrome-profile')}`,
    `--pack-extension=${stage}`, `--pack-extension-key=${keyPath}`,
  ], { stdio: 'inherit', timeout: 120000 })
  const bytes = await readFile(stage + '.crx')
  if (bytes.toString('ascii', 0, 4) !== 'Cr24' || bytes.readUInt32LE(4) !== 3) {
    throw new Error('Chrome did not produce a CRX3 package')
  }
  names.push(`${basename}.crx`)
  await rename(stage + '.crx', path.join(output, names[1]))
}
await writeFile(path.join(output, 'package-info.json'), JSON.stringify({
  version, extensionId: extensionId || null, signed: !zipOnly,
  sourceCommit: process.env.SOURCE_COMMIT || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  protection: 'esbuild whitespace and local identifier minification; not encryption',
}, null, 2) + '\n')
names.push('package-info.json')
const hashes = await Promise.all(names.map(async (name) =>
  `${createHash('sha256').update(await readFile(path.join(output, name))).digest('hex')}  ${name}`))
await writeFile(path.join(output, 'SHA256SUMS'), hashes.join('\n') + '\n')
console.log(`Extension ${version}: ${names.join(', ')}${extensionId ? `; ID ${extensionId}` : '; unsigned ZIP only'}`)
