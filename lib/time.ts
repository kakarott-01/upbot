export function toUtcIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null

  const date = value instanceof Date ? value : new Date(value)
  const timestamp = date.getTime()

  if (Number.isNaN(timestamp)) return null
  return new Date(timestamp).toISOString()
}

export function getUtcTimestamp(value: string | null | undefined): number | null {
  if (!value) return null

  const timestamp = new Date(value).getTime()
  return Number.isNaN(timestamp) ? null : timestamp
}

export function getSessionDurationMs(
  startedAt: string | null | undefined,
  stoppedAt: string | null | undefined,
  now: number,
): number {
  const startedAtMs = getUtcTimestamp(startedAt)
  if (startedAtMs === null) return 0

  const stoppedAtMs = getUtcTimestamp(stoppedAt)
  const endMs = stoppedAtMs ?? now

  return Math.max(0, endMs - startedAtMs)
}

export function formatElapsedDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) return `${hours}h ${minutes}m ${String(seconds).padStart(2, '0')}s`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}
