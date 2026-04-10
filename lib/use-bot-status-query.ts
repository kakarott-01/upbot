'use client'

import { useQuery, type UseQueryOptions } from '@tanstack/react-query'
import {
  BOT_STATUS_POLL_INTERVAL_MS,
  BOT_STATUS_QUERY_KEY,
  type BotStatusSnapshot,
  fetchBotStatus,
} from '@/lib/bot-status-client'

export function useBotStatusQuery(
  options?: Omit<UseQueryOptions<BotStatusSnapshot>, 'queryKey' | 'queryFn'>,
) {
  return useQuery({
    queryKey: BOT_STATUS_QUERY_KEY,
    queryFn: fetchBotStatus,
    refetchInterval: (data) => {
      if (!data) return 5_000
      return data.status === 'running' || data.status === 'stopping' ? 3_000 : 10_000
    },
    placeholderData: (prev) => prev,
    ...options,
  })
}
