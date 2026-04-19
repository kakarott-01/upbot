type ApiError = Error & { status?: number; data?: any }

export async function apiFetch<T>(input: RequestInfo | URL, init?: RequestInit, timeoutMs = 8_000): Promise<T> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const upstreamSignal = init?.signal

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort()
    else upstreamSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  let res: Response
  try {
    res = await fetch(input, { ...init, signal: controller.signal })
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const error = new Error(
      typeof body?.error === 'string' ? body.error : `HTTP ${res.status}`,
    ) as ApiError
    error.status = res.status
    error.data = body
    throw error
  }

  return res.json() as Promise<T>
}
