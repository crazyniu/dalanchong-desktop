#!/usr/bin/env node
/**
 * AI module map
 * Purpose: launch the macOS development main executable inside a real .app bundle.
 * Entry: .cargo/config.toml supplies Cargo's executable path followed by app arguments.
 * Flow: copy debug/dalanchong into .work/dev-app/大懒虫.app, write the current native
 * name/identity/version/icon, sign the development copy, then execve it in this PID.
 * Cargo/Tauri therefore still own the actual app process for hot reload and shutdown.
 * State: only the generated development bundle is written; the compiled Cargo artifact
 * and inherited working directory, environment, stdio and application data stay intact.
 * Non-main Cargo targets are passed through without creating a bundle. Release builds
 * continue to use Tauri's bundler. Node 24 is the project's existing prerequisite.
 */

import { execFileSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, rename } from 'node:fs/promises'
import path from 'node:path'

const executable = path.resolve(process.argv[2])
const args = process.argv.slice(3)
const isDevApp = path.basename(executable) === 'dalanchong'
  && path.basename(path.dirname(executable)) === 'debug'

if (!isDevApp) {
  process.execve(executable, [executable, ...args], process.env)
} else {
  const root = path.resolve(import.meta.dirname, '..')
  const config = JSON.parse(await readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
  const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
  const app = path.join(root, '.work/dev-app', `${config.productName}.app`)
  const contents = path.join(app, 'Contents')
  const macos = path.join(contents, 'MacOS')
  const resources = path.join(contents, 'Resources')
  await mkdir(macos, { recursive: true })
  await mkdir(resources, { recursive: true })

  // A real copy keeps NSBundle anchored inside .app. A symlink back to Cargo's
  // artifact would resolve to the bare executable and lose the bundle identity.
  const bundledExecutable = path.join(macos, 'dalanchong')
  const pendingExecutable = path.join(root, '.work/dev-app', `.dalanchong-${process.pid}`)
  await copyFile(executable, pendingExecutable)
  await chmod(pendingExecutable, 0o755)
  await rename(pendingExecutable, bundledExecutable)
  await copyFile(path.join(root, 'assets/icons/app.icns'), path.join(resources, 'app.icns'))

  const info = JSON.parse(execFileSync('/usr/bin/plutil', [
    '-convert', 'json', '-o', '-', path.join(root, 'src-tauri/Info.plist'),
  ], { encoding: 'utf8' }))
  Object.assign(info, {
    CFBundleName: config.productName,
    CFBundleDisplayName: config.productName,
    CFBundleExecutable: 'dalanchong',
    CFBundleIdentifier: config.identifier,
    CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version,
    CFBundleVersion: version,
    CFBundleIconFile: 'app.icns',
    LSMinimumSystemVersion: config.bundle.macOS.minimumSystemVersion,
    NSHighResolutionCapable: true,
  })
  execFileSync('/usr/bin/plutil', ['-convert', 'xml1', '-o', path.join(contents, 'Info.plist'), '-'], {
    input: JSON.stringify(info),
  })
  execFileSync('/usr/bin/xattr', ['-cr', app])
  execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', '--options', '0', '--timestamp=none', app])

  // Replace this runner rather than spawning an untracked GUI child. Tauri's
  // watcher can terminate/restart the same PID and observe the real exit status.
  process.execve(bundledExecutable, [bundledExecutable, ...args], process.env)
}
