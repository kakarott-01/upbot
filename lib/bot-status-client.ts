import type { QueryClient } from '@tanstack/react-query'

export const BOT_STATUS_QUERY_KEY = ['bot-status'] as const
export const BOT_STATUS_POLL_INTERVAL_MS = 5_000

export type BotStatusSessionSnapshot = {
  market: string
  status: 'running' | 'stopped' | 'error'
  sessionId: string | null
  mode: 'paper' | 'live' | null
  started_at: string | null
  stopped_at: string | null
  exchange: string | null
  openTrades: number
  totalTrades: number
  totalPnl: string | number | null
  metadata: unknown
}

export type BotStatusSnapshot = {
  status: 'running' | 'stopped' | 'stopping' | 'error'
  stopMode: string | null
  activeMarkets: string[]
  started_at: string | null
  stopped_at: string | null
  stopping_at: string | null
  last_heartbeat: string | null
  errorMessage: string | null
  openTradeCount: number
  perMarketOpenTrades: Record<string, number>
  timeoutWarning: boolean
  sessions: BotStatusSessionSnapshot[]
}

export async function fetchBotStatus(): Promise<BotStatusSnapshot> {
  const response = await fetch('/api/bot/status', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error(`Failed to fetch bot status (HTTP ${response.status})`)
  }

  return response.json()
}

export function getBotStatusSignature(snapshot: BotStatusSnapshot | null | undefined): string {
  if (!snapshot) return 'null'

  return JSON.stringify({
    status: snapshot.status,
    stopMode: snapshot.stopMode,
    started_at: snapshot.started_at,
    stopped_at: snapshot.stopped_at,
    stopping_at: snapshot.stopping_at,
    activeMarkets: [...snapshot.activeMarkets].sort(),
    sessions: snapshot.sessions.map((session) => ({
      market: session.market,
      status: session.status,
      sessionId: session.sessionId,
      started_at: session.started_at,
      stopped_at: session.stopped_at,
    })),
  })
}

export function getBotSyncEventType(snapshot: BotStatusSnapshot): 'BOT_STARTED' | 'BOT_STOPPED' | 'BOT_UPDATED' {
  if (snapshot.status === 'running' && snapshot.started_at) return 'BOT_STARTED'
  if (snapshot.status === 'stopped') return 'BOT_STOPPED'
  return 'BOT_UPDATED'
}

export function applyBotStatusSnapshot(
  queryClient: QueryClient,
  snapshot: BotStatusSnapshot,
  source: string,
) {
  const previous = queryClient.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)

  if (
    previous?.status === 'running' &&
    snapshot.status === 'running' &&
    previous.started_at &&
    snapshot.started_at &&
    previous.started_at !== snapshot.started_at
  ) {
    console.warn('[bot-sync] started_at changed while bot remained running', {
      source,
      previousStartedAt: previous.started_at,
      nextStartedAt: snapshot.started_at,
    })
  }

  queryClient.setQueryData(BOT_STATUS_QUERY_KEY, snapshot)
}

export async function refreshBotStatus(queryClient: QueryClient, source: string) {
  const snapshot = await queryClient.fetchQuery({
    queryKey: BOT_STATUS_QUERY_KEY,
    queryFn: fetchBotStatus,
    staleTime: 0,
  })

  applyBotStatusSnapshot(queryClient, snapshot, source)
  return snapshot
}
