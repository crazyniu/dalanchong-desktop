import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { restoreCookieSnapshot } from '../electron/cookie-snapshot.mjs'

test('an undecryptable snapshot is preserved and does not block the existing browser session', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'assistant-cookie-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'account.cookies')
  const original = Buffer.from('unreadable-encrypted-snapshot')
  await writeFile(file, original)
  const errors = []
  const restored = await restoreCookieSnapshot({
    file,
    encryption: {
      decryptStringAsync: async () => {
        throw Error(
          'Error while decrypting the ciphertext provided to safeStorage.decryptStringAsync.'
        )
      },
    },
    cookies: {
      set: async () => {
        throw Error('existing browser cookies must remain untouched')
      },
    },
    onError: (error, backup) => errors.push({ message: error.message, backup }),
  })
  assert.equal(restored, false)
  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /decrypting the ciphertext/)
  assert.deepEqual(await readFile(errors[0].backup), original)
  assert.deepEqual(await readdir(directory), [path.basename(errors[0].backup)])
})

test('valid snapshots still restore session cookies and omit expired cookies', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'assistant-cookie-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'account.cookies')
  await writeFile(file, 'encrypted')
  const restored = []
  const cookie = {
    name: 'session',
    value: 'test-value',
    domain: 'example.invalid',
    path: '/',
    secure: true,
    hostOnly: true,
  }
  assert.equal(
    await restoreCookieSnapshot({
      file,
      encryption: {
        decryptStringAsync: async () => ({
          result: JSON.stringify([
            cookie,
            { ...cookie, name: 'expired', expirationDate: 1 },
          ]),
        }),
      },
      cookies: { set: async (value) => restored.push(value) },
      onError: () => {
        throw Error('unexpected recovery error')
      },
    }),
    true
  )
  assert.equal(restored.length, 1)
  assert.equal(restored[0].url, 'https://example.invalid/')
  assert.equal(restored[0].value, 'test-value')
  assert.equal(restored[0].expirationDate, undefined)
  assert.equal(await readFile(file, 'utf8'), 'encrypted')
})
