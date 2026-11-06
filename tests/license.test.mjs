import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { LicenseService, APP_ID } from '../electron/license.mjs'

const code = 'ABCD-EFGH-JKLM-NPQR-STUV-WXYZ'
const active = {
  valid: true,
  reason: 'active',
  activated_at: '2026-11-06T00:00:00Z',
  expires_at: '2026-11-13T00:00:00Z',
}
// Storage adapter only; actual OS encryption is checked in the Electron smoke run.
const encryption = {
  encryptStringAsync: async (value) => Buffer.from(value),
  decryptStringAsync: async (value) => ({ result: value.toString() }),
}
async function fixture(t, request) {
  const dir = await mkdtemp(path.join(tmpdir(), 'desktop-license-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const options = { file: path.join(dir, 'license.json'), encryption, request }
  const service = new LicenseService(options)
  await service.initialize()
  return { service, options }
}

test('restart preserves the install ID and verifies without activating or extending dates', async (t) => {
  const calls = []
  const { service, options } = await fixture(t, async (url, init) => {
    calls.push({ action: url.split('/').at(-1), ...JSON.parse(init.body) })
    return Response.json(active)
  })
  assert.match(service.state.deviceId, /^[0-9a-f-]{36}$/)
  assert.equal((await service.verify()).valid, false)
  assert.equal(calls.length, 0)
  assert.equal((await service.activate(code)).valid, true)
  const restarted = new LicenseService(options)
  await restarted.initialize()
  assert.equal(restarted.state.valid, false)
  await restarted.requireValid()
  assert.deepEqual(
    calls.map((c) => c.action),
    ['activate', 'verify']
  )
  assert.equal(calls[0].app_id, APP_ID)
  assert.equal(calls[0].device_id, calls[1].device_id)
  assert.equal(restarted.state.deviceId, calls[0].device_id)
  assert.equal(restarted.state.expiresAt, active.expires_at)
  assert.equal(restarted.state.activatedAt, active.activated_at)
  assert.ok(
    !(await readFile(options.file, 'utf8')).includes(code.replace(/-/g, ''))
  )
})

test('an invalid replacement keeps the saved activation', async (t) => {
  let valid = true
  const { service, options } = await fixture(t, async () =>
    Response.json(valid ? active : { valid: false, reason: 'invalid_license' })
  )
  await service.activate(code)
  const saved = await readFile(options.file, 'utf8')
  valid = false
  assert.equal(
    (await service.activate('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF')).valid,
    false
  )
  assert.equal(await readFile(options.file, 'utf8'), saved)
  assert.equal(service.state.valid, true)
})

test('network failure, expiry and unbinding block work without automatic reactivation', async (t) => {
  let result = active
  const actions = []
  const { service } = await fixture(t, async (url) => {
    actions.push(url.split('/').at(-1))
    if (result === null) throw Error('offline')
    return Response.json(result)
  })
  await service.activate(code)
  for (const reason of [
    'device_unbound',
    'expired',
    'device_mismatch',
    'device_disabled',
    'network_error',
  ]) {
    result = reason === 'network_error' ? null : { valid: false, reason }
    await assert.rejects(
      service.requireValid(),
      (error) => error.beforeSend === true
    )
    assert.equal(service.state.valid, false)
    assert.equal(service.state.reason, reason)
  }
  assert.deepEqual(actions, [
    'activate',
    'verify',
    'verify',
    'verify',
    'verify',
    'verify',
  ])
})
