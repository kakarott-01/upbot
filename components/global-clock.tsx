'use client'

import { useEffect } from 'react'
import { useGlobalClockStore } from '@/lib/global-clock-store'

const CLOCK_TICK_INTERVAL_MS = 1_000
const CLOCK_SYNC_INTERVAL_MS = 5 * 60_000

async function fetchServerNowMs(): Promise<number | null> {
  try {
    const response = await fetch('/api/time', { cache: 'no-store' })
    if (!response.ok) return null

    const data = await response.json()
    if (typeof data.server_now_ms === 'number') return data.server_now_ms
    if (typeof data.server_time === 'string') {
      const timestamp = new Date(data.server_time).getTime()
      return Number.isNaN(timestamp) ? null : timestamp
    }
  } catch {
    return null
  }

  return null
}

export function GlobalClockBootstrap() {
  const tick = useGlobalClockStore((state) => state.tick)
  const syncWithServer = useGlobalClockStore((state) => state.syncWithServer)

  useEffect(() => {
    let cancelled = false

    const syncClock = async () => {
      const serverNowMs = await fetchServerNowMs()
      if (!cancelled && typeof serverNowMs === 'number') {
        syncWithServer(serverNowMs)
      }
    }

    const handleVisibilityChange = () => {
      tick()
      if (document.visibilityState === 'visible') {
        void syncClock()
      }
    }

    tick()
    void syncClock()

    const tickTimer = window.setInterval(() => {
      tick()
    }, CLOCK_TICK_INTERVAL_MS)

    const syncTimer = window.setInterval(() => {
      void syncClock()
    }, CLOCK_SYNC_INTERVAL_MS)

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(tickTimer)
      window.clearInterval(syncTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [syncWithServer, tick])

  return null
}
