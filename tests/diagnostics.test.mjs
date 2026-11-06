import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { Diagnostics } from '../electron/diagnostics.mjs'

test('diagnostics restores recent errors, retains full error history for export, and redacts secrets', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'assistant-diagnostics-')
  )
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'assistant-data', 'errors.ndjson')
  const events = []
  const diagnostics = new Diagnostics({
    file,
    onEntry: (entry) => events.push(entry),
  })
  await diagnostics.initialize()
  assert.equal(
    diagnostics.record({ level: 'info', message: '正常进度' }),
    undefined
  )
  assert.equal(events.length, 0)
  assert.equal(await readFile(file, 'utf8'), '')
  const first = diagnostics.record({
    accountId: 'account-a',
    platform: 'douyin',
    taskId: 'task-a',
    kind: 'collect',
    level: 'error',
    message: '采集失败 token=private-token',
    response: {
      status: 501,
      body: JSON.stringify({
        reason: 'upstream unavailable',
        requestId: 'request-501',
        token: 'private-token',
      }),
      nested: { cookie: 'private-cookie', requestBody: 'private-request' },
    },
    code: 'private-activation',
  })
  assert.equal(events[0], first)
  assert.deepEqual(JSON.parse(first.response.body), {
    reason: 'upstream unavailable',
    requestId: 'request-501',
    token: '[已隐藏]',
  })
  for (let i = 0; i < 1000; i++)
    diagnostics.record({
      taskId: 'task-b',
      kind: 'collect',
      level: 'error',
      message: `采集错误 ${i}`,
    })
  assert.equal(diagnostics.entries.length, 1000)
  assert.equal(diagnostics.entries[0].message, '采集错误 0')
  const restored = new Diagnostics({ file, onEntry: () => {} })
  await restored.initialize()
  assert.deepEqual(
    restored.entries,
    diagnostics.entries.map((entry) => JSON.parse(JSON.stringify(entry)))
  )
  const destination = path.join(directory, 'export.ndjson')
  await restored.exportTo(destination)
  const content = await readFile(file, 'utf8')
  assert.equal(await readFile(destination, 'utf8'), content)
  assert.equal(content.trim().split('\n').length, 1001)
  assert.ok(content.includes(first.id))
  assert.ok(content.includes('upstream unavailable'))
  assert.ok(content.includes('request-501'))
  assert.ok(!content.includes('private-'))
  assert.equal((await stat(file)).mode & 0o777, 0o600)
})

test('append failure is immediately visible in callbacks and console without throwing recursively', async (t) => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'assistant-diagnostics-failure-')
  )
  t.after(() => rm(directory, { recursive: true, force: true }))
  const file = path.join(directory, 'errors.ndjson')
  const events = []
  const consoleErrors = []
  t.mock.method(console, 'error', (message) => consoleErrors.push(message))
  const diagnostics = new Diagnostics({
    file,
    onEntry: (entry) => events.push(entry),
  })
  await diagnostics.initialize()
  await rm(file)
  await mkdir(file)
  assert.doesNotThrow(() =>
    diagnostics.record({
      accountId: 'account-a',
      taskId: 'task-a',
      kind: 'collect',
      level: 'error',
      message: '采集失败',
    })
  )
  assert.equal(events.length, 2)
  assert.equal(events[1].level, 'error')
  assert.equal(events[1].accountId, 'account-a')
  assert.equal(events[1].kind, 'collect')
  assert.match(events[1].message, /诊断日志保存失败/)
  assert.deepEqual(consoleErrors, [events[1].message])
  assert.equal(diagnostics.entries.at(-1), events[1])
})
