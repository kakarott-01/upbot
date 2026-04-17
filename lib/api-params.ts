export function boundedIntParam(
  value: string | null,
  fallback: number,
  options: { min?: number; max?: number } = {},
) {
  const min = options.min ?? 1
  const max = options.max ?? Number.MAX_SAFE_INTEGER
  const parsed = Number.parseInt(value ?? '', 10)

  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

export function dateParam(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}
