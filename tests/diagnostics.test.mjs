import assert from 'node:assert/strict'
import test from 'node:test'
import { createRuntime } from '../src/desktop-runtime/runtime.mjs'

function fixture({ logs = [], append = async () => {} } = {}) {
  const events = []
  const entries = []
  const commands = []
  const bridge = createRuntime(
    async (command, args) => {
      commands.push(command)
      if (command === 'license_verify') return { valid: true }
      if (command === 'runtime_load')
        return { logs, talents: [], records: [], tasks: {}, collections: [] }
      if (command === 'update_check')
        throw Object.assign(Error('上游不可用 token=private-token'), {
          response: {
            path: '/updates',
            method: 'GET',
            status: 501,
            requestId: 'request-501',
            body: JSON.stringify({
              reason: 'upstream unavailable',
              token: 'private-token',
              contact: 'private-contact',
              nested: { cookie: 'private-cookie' },
            }),
          },
        })
      if (command === 'diagnostic_append') {
        entries.push(args.entry)
        await append(args.entry)
      }
      if (command === 'diagnostic_export') return true
    },
    async () => () => {},
    null
  )
  bridge.onEvent((event) => events.push(event))
  return { bridge, events, entries, commands }
}

test('runtime restores errors, limits displayed history and sends redacted diagnostics before export', async () => {
  const logs = [
    { level: 'info', message: '正常进度' },
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `old-${i}`,
      level: 'error',
      message: `既有错误 ${i}`,
    })),
  ]
  const { bridge, events, entries, commands } = fixture({ logs })
  assert.equal((await bridge.initialize()).logs.length, 1000)
  assert.equal(entries.length, 0)
  await assert.rejects(bridge.checkForUpdates(), /上游不可用/)
  assert.equal(await bridge.exportLogs(), true)

  assert.equal(entries.length, 1)
  const [entry] = entries
  assert.equal(entry.level, 'error')
  assert.equal(entry.response.status, 501)
  assert.equal(entry.response.requestId, 'request-501')
  assert.deepEqual(JSON.parse(entry.response.body), {
    reason: 'upstream unavailable',
    token: '[已隐藏]',
    contact: '[已隐藏]',
    nested: { cookie: '[已隐藏]' },
  })
  assert.ok(!JSON.stringify(entry).includes('private-'))
  const displayed = events.filter((event) => event.type === 'runtime').at(-1)
  assert.equal(displayed.data.logs.length, 1000)
  assert.equal(displayed.data.logs[0].id, 'old-1')
  assert.deepEqual(displayed.data.logs.at(-1), entry)
  assert.ok(
    commands.indexOf('diagnostic_append') < commands.indexOf('diagnostic_export')
  )
})

test('native diagnostic write failure is visible and is not recursively logged', async () => {
  const { bridge, events, entries } = fixture({
    append: async () => {
      throw Error('磁盘已满')
    },
  })
  await bridge.initialize()
  await assert.rejects(bridge.checkForUpdates(), /上游不可用/)
  await bridge.exportLogs()
  assert.equal(entries.length, 1)
  assert.deepEqual(
    events.filter((event) => event.type === 'error'),
    [{ type: 'error', message: '错误日志保存失败：磁盘已满' }]
  )
})
