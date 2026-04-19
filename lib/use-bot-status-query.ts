'use client'

import { useQuery, type Query, type UseQueryOptions } from '@tanstack/react-query'
import { BOT_STATUS_QUERY_KEY, type BotStatusSnapshot, fetchBotStatus } from '@/lib/bot-status-client'
import { POLL_INTERVALS } from '@/lib/polling-config'

export function useBotStatusQuery<TData = BotStatusSnapshot>(
  options?: Omit<UseQueryOptions<BotStatusSnapshot, Error, TData>, 'queryKey' | 'queryFn'>,
) {
  return useQuery<BotStatusSnapshot, Error, TData>({
    queryKey: BOT_STATUS_QUERY_KEY,
    queryFn: fetchBotStatus,
    refetchInterval: (query: Query<BotStatusSnapshot, Error, BotStatusSnapshot, readonly unknown[]>) => {
      const data = query.state.data
      if (!data) return POLL_INTERVALS.BOT_RUNNING
      return data.status === 'running' || data.status === 'stopping'
        ? POLL_INTERVALS.BOT_RUNNING
        : POLL_INTERVALS.BOT_IDLE
    },
    placeholderData: (prev) => prev,
    ...options,
  })
}
