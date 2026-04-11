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
  return useQuery<BotStatusSnapshot>({
    queryKey: BOT_STATUS_QUERY_KEY,
    queryFn: fetchBotStatus,
    refetchInterval: (maybeDataOrQuery: any) => {
      const data: BotStatusSnapshot | undefined =
        maybeDataOrQuery && typeof maybeDataOrQuery.status === 'string'
          ? maybeDataOrQuery
          : maybeDataOrQuery?.data ?? maybeDataOrQuery?.state?.data

      if (!data) return BOT_STATUS_POLL_INTERVAL_MS
      // FIX: 8s when running (was 3s), 15s when stopped (was 10s)
      // Reduces Neon queries by ~60% with negligible UX impact
      return data.status === 'running' || data.status === 'stopping' ? 8_000 : 15_000
    },
    placeholderData: (prev) => prev,
    ...options,
  })
}