import { existsSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'

export async function restoreCookieSnapshot({
  file,
  encryption,
  cookies,
  onError,
}) {
  if (!existsSync(file)) return true
  const encrypted = await readFile(file)
  let snapshot
  try {
    const { result } = await encryption.decryptStringAsync(encrypted)
    snapshot = JSON.parse(result)
  } catch (error) {
    // A broken snapshot must not prevent opening the persistent browser session.
    const backup = `${file}.unreadable-${Date.now()}`
    await rename(file, backup)
    onError(error, backup)
    return false
  }
  for (const c of snapshot) {
    if (c.expirationDate && c.expirationDate <= Date.now() / 1000) continue
    await cookies.set({
      url: `${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`,
      name: c.name,
      value: c.value,
      ...(c.hostOnly ? {} : { domain: c.domain }),
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      ...(c.expirationDate ? { expirationDate: c.expirationDate } : {}),
    })
  }
  return true
}
