'use client'

import { useBotStatusQuery } from './use-bot-status-query'

export function useTradingGuard() {
  const { data } = useBotStatusQuery()

  const isRunning = data?.status === 'running' || data?.status === 'stopping'

  return { isRunning }
}
