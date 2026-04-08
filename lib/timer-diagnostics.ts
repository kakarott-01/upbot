'use client'

import { useEffect } from 'react'

type TimerSample = {
  scope: string
  elapsedMs: number
  startedAt: string
}

const timerRegistry = new Map<string, Map<string, TimerSample>>()

function getTimerBucket(timerKey: string) {
  let bucket = timerRegistry.get(timerKey)
  if (!bucket) {
    bucket = new Map<string, TimerSample>()
    timerRegistry.set(timerKey, bucket)
  }
  return bucket
}

function registerElapsedSample(timerKey: string, sample: TimerSample) {
  const bucket = getTimerBucket(timerKey)
  bucket.set(sample.scope, sample)

  const samples = Array.from(bucket.values())
  if (samples.length < 2) return

  const minElapsedMs = Math.min(...samples.map((entry) => entry.elapsedMs))
  const maxElapsedMs = Math.max(...samples.map((entry) => entry.elapsedMs))

  if (maxElapsedMs - minElapsedMs > 1_000) {
    console.error('[bot-timer] elapsed mismatch detected across components', {
      timerKey,
      samples,
    })
  }
}

function unregisterElapsedSample(timerKey: string, scope: string) {
  const bucket = timerRegistry.get(timerKey)
  if (!bucket) return

  bucket.delete(scope)
  if (bucket.size === 0) {
    timerRegistry.delete(timerKey)
  }
}

export function useElapsedTimerDiagnostics(
  scope: string,
  startedAt: string | null | undefined,
  elapsedMs: number | null,
) {
  useEffect(() => {
    if (!startedAt || elapsedMs === null) return

    const timerKey = `session:${startedAt}`
    registerElapsedSample(timerKey, {
      scope,
      elapsedMs,
      startedAt,
    })

    return () => {
      unregisterElapsedSample(timerKey, scope)
    }
  }, [elapsedMs, scope, startedAt])
}

export function useStartedAtInvariant(
  scope: string,
  status: string,
  startedAt: string | null | undefined,
) {
  useEffect(() => {
    if (typeof window === 'undefined') return

    const registry = (window as typeof window & {
      __botStartedAtInvariant__?: Map<string, string | null>
    })

    if (!registry.__botStartedAtInvariant__) {
      registry.__botStartedAtInvariant__ = new Map()
    }

    const previousStartedAt = registry.__botStartedAtInvariant__.get(scope) ?? null
    if (
      previousStartedAt &&
      startedAt &&
      previousStartedAt !== startedAt &&
      status === 'running'
    ) {
      console.warn('[bot-timer] started_at changed unexpectedly', {
        scope,
        previousStartedAt,
        nextStartedAt: startedAt,
      })
    }

    registry.__botStartedAtInvariant__.set(scope, startedAt ?? null)
  }, [scope, startedAt, status])
}
