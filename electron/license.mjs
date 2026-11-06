import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile, rename } from 'node:fs/promises'

export const APP_ID = 'dalanchong'
const API_URL =
  'https://lfrgswefkgdzhureqzod.supabase.co/functions/v1/license-api'

const messages = {
  not_activated: '请输入激活码',
  invalid_license: '激活码无效，请检查是否属于大懒虫',
  device_unbound: '设备已解绑，请重新激活',
  device_mismatch: '激活码已绑定其他设备，请先在后台解绑',
  device_disabled: '此设备已被禁用，请联系管理员',
  expired: '激活码已过期，请更换激活码',
  network_error: '无法连接授权服务，请联网后重试',
}

export class LicenseService {
  constructor({ file, encryption, request = fetch, onChange = () => {} }) {
    Object.assign(this, { file, encryption, request, onChange })
    this.state = {
      valid: false,
      reason: 'not_activated',
      hasCode: false,
      deviceId: '',
      message: '',
      activatedAt: null,
      expiresAt: null,
    }
    this.queue = Promise.resolve()
    this.code = ''
  }
  async initialize() {
    if (existsSync(this.file)) {
      this.saved = JSON.parse(await readFile(this.file, 'utf8'))
      if (this.saved.encryptedCode) {
        const { result } = await this.encryption.decryptStringAsync(
          Buffer.from(this.saved.encryptedCode, 'base64')
        )
        this.code = result
      }
    } else {
      this.saved = { deviceId: randomUUID(), encryptedCode: null }
      await this.persist(this.saved)
    }
    this.state = {
      ...this.state,
      deviceId: this.saved.deviceId,
      hasCode: Boolean(this.code),
    }
  }
  async persist(saved) {
    await writeFile(this.file + '.tmp', JSON.stringify(saved), { mode: 0o600 })
    await rename(this.file + '.tmp', this.file)
  }
  serial(operation) {
    const pending = this.queue.then(operation)
    this.queue = pending.catch(() => {})
    return pending
  }
  publish(result) {
    this.state = {
      valid: result.valid === true,
      reason: result.reason,
      message: messages[result.reason] || '',
      expiresAt: result.expires_at ?? null,
      activatedAt: result.activated_at ?? null,
      hasCode: Boolean(this.code),
      deviceId: this.saved.deviceId,
    }
    this.onChange(this.state)
    return this.state
  }
  async call(action, code) {
    try {
      const response = await this.request(`${API_URL}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_id: APP_ID,
          code,
          device_id: this.saved.deviceId,
        }),
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) throw Error('License service unavailable')
      return await response.json()
    } catch {
      return { valid: false, reason: 'network_error' }
    }
  }
  verify() {
    return this.serial(async () =>
      this.publish(
        this.code
          ? await this.call('verify', this.code)
          : { valid: false, reason: 'not_activated' }
      )
    )
  }
  activate(input) {
    return this.serial(async () => {
      const code =
        typeof input === 'string'
          ? input.toUpperCase().replace(/[\s-]/g, '')
          : ''
      const result = /^[A-HJ-NP-Z2-9]{24}$/.test(code)
        ? await this.call('activate', code)
        : { valid: false, reason: 'invalid_license' }
      if (!result.valid) {
        // A mistyped replacement must not discard the current activation.
        if (!this.state.valid) this.publish(result)
        return { valid: false, message: messages[result.reason] }
      }
      const encrypted = await this.encryption.encryptStringAsync(code)
      const saved = {
        ...this.saved,
        encryptedCode: encrypted.toString('base64'),
      }
      await this.persist(saved)
      this.saved = saved
      this.code = code
      this.publish(result)
      return { valid: true }
    })
  }
  async requireValid() {
    const state = await this.verify()
    if (!state.valid)
      throw Object.assign(Error(state.message), { beforeSend: true })
  }
}
