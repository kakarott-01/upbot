// Lightweight localStorage safety helpers
// - Avoids throwing when storage is full or unavailable
// - Skips writes that exceed a configurable byte size (default 64 KiB)

export function getByteSize(str: string): number {
  try {
    return new TextEncoder().encode(str).length
  } catch {
    // Fallback: approximate by string length (UTF-16 code units)
    return str.length * 2
  }
}

export function safeLocalSet(key: string, value: unknown, maxBytes = 64 * 1024): boolean {
  if (typeof window === 'undefined' || !('localStorage' in window)) return false

  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    const size = getByteSize(str)
    if (size > maxBytes) {
      // Do not attempt the write if payload is too large
      // Keep a single line console warning for diagnostics only.
      // Avoid throwing; caller should handle the absence of a write.
      // eslint-disable-next-line no-console
      console.warn(`[localStorage] skip set ${key}: ${size} bytes > ${maxBytes} bytes`)
      return false
    }

    window.localStorage.setItem(key, str)
    return true
  } catch {
    // localStorage can throw if quota exceeded or in private mode.
    return false
  }
}

export function safeLocalGet(key: string): string | null {
  if (typeof window === 'undefined' || !('localStorage' in window)) return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}
