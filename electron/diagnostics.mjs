import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { mkdir, open, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const sensitiveKey =
  /cookie|authorization|password|token|secret|license|activation|request[_-]?body|激活码|密码/i

function redactText(value) {
  return value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [已隐藏]')
    .replace(
      /(^|\n)((?:set-cookie|cookie|authorization)\s*:\s*)[^\r\n]*/gi,
      '$1$2[已隐藏]'
    )
    .replace(
      /((?:access_token|refresh_token|token|password|secret|license_code|activation_code|cookie|authorization|激活码|密码)["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&}\]]+)/gi,
      (_match, prefix, value) =>
        prefix +
        (value.startsWith('"')
          ? '"[已隐藏]"'
          : value.startsWith("'")
            ? "'[已隐藏]'"
            : '[已隐藏]')
    )
}

function redact(value) {
  if (typeof value === 'string') return redactText(value)
  if (Array.isArray(value)) return value.map(redact)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? '[已隐藏]' : redact(item),
      ])
    )
  return value
}

export class Diagnostics {
  constructor({ file, onEntry }) {
    this.file = file
    this.onEntry = onEntry
    this.entries = []
  }

  async initialize() {
    await mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 })
    const handle = await open(this.file, 'a', 0o600)
    await handle.close()
    const content = await readFile(this.file, 'utf8')
    this.entries = content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.level === 'error')
      .slice(-1000)
  }

  publish(entry) {
    this.entries.push(entry)
    if (this.entries.length > 1000) this.entries.shift()
    this.onEntry(entry)
  }

  record({ accountId, platform, taskId, kind, level, message, response }) {
    if (level !== 'error') return
    const entry = {
      id: randomUUID(),
      time: new Date().toISOString(),
      accountId,
      platform,
      taskId,
      kind,
      level,
      message: redactText(message),
      ...(response === undefined ? {} : { response: redact(response) }),
    }
    let failure
    try {
      appendFileSync(this.file, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
    } catch (error) {
      failure = error
    }
    this.publish(entry)
    if (failure) {
      const failed = {
        id: randomUUID(),
        time: new Date().toISOString(),
        accountId,
        platform,
        taskId,
        kind,
        level: 'error',
        message: `诊断日志保存失败：${redactText(failure.message)}`,
      }
      console.error(failed.message)
      this.publish(failed)
    }
    return entry
  }

  async exportTo(destination) {
    const content = await readFile(this.file, 'utf8')
    const errors = content
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.level === 'error')
    await writeFile(
      destination,
      errors.map((entry) => JSON.stringify(entry) + '\n').join(''),
      { mode: 0o600 }
    )
  }
}
