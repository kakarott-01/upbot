'use client'

import { useBotStatusQuery } from './use-bot-status-query'

export function useTradingGuard() {
  const { data } = useBotStatusQuery({
    select: (snapshot) => snapshot.status,
  })

  const isRunning = data === 'running' || data === 'stopping'

  return { isRunning }
}
