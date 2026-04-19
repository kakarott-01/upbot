'use client'

import { useEffect, useState } from 'react'
import { formatElapsedDuration, getSessionDurationMs } from '@/lib/time'

type ElapsedTimerProps = {
  startedAt: string | null
}

export function ElapsedTimer({ startedAt }: ElapsedTimerProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!startedAt) return

    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  if (!startedAt) return null

  return <>{formatElapsedDuration(getSessionDurationMs(startedAt, null, now))}</>
}
