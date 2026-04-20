import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { botSessions, botStatuses, trades } from '@/lib/schema'
import { toUtcIsoString } from '@/lib/time'

const BOT_MARKETS = ['crypto', 'indian', 'global', 'commodities'] as const

export type BotStatusSnapshotData = {
  status: 'running' | 'stopped' | 'stopping' | 'paused' | 'error'
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
  sessions: Array<{
    market: string
    status: 'running' | 'stopping' | 'stopped' | 'error'
    sessionId: string | null
    mode: 'paper' | 'live' | null
    started_at: string | null
    stopped_at: string | null
    exchange: string | null
    openTrades: number
    totalTrades: number
    totalPnl: string | number | null
    metadata: unknown
  }>
}

type BotStatusRow = Awaited<ReturnType<typeof db.query.botStatuses.findFirst>>
type BotSessionRow = Awaited<ReturnType<typeof db.query.botSessions.findMany>>[number]

function buildSessions(
  statusRow: BotStatusRow,
  sessionRows: BotSessionRow[],
  activeMarketsSet: Set<string>,
) {
  const latestSessionByMarket = new Map<string, BotSessionRow>()

  for (const row of sessionRows) {
    if (!latestSessionByMarket.has(row.market)) {
      latestSessionByMarket.set(row.market, row)
    }
  }

  return BOT_MARKETS.map((market) => {
    const row = latestSessionByMarket.get(market)
    const isActive = activeMarketsSet.has(market)
    const sessionStatus = row?.status ?? (isActive ? 'running' : 'stopped')

    return {
      market,
      status: sessionStatus,
      sessionId: row?.id ?? null,
      mode: row?.mode ?? null,
      started_at: toUtcIsoString(
        isActive ? statusRow?.startedAt ?? row?.startedAt ?? null : row?.startedAt ?? null,
      ),
      stopped_at: toUtcIsoString(isActive ? null : row?.endedAt ?? null),
      exchange: row?.exchange ?? null,
      openTrades: row?.openTrades ?? 0,
      totalTrades: row?.totalTrades ?? 0,
      totalPnl: row?.totalPnl ?? null,
      metadata: row?.metadata ?? null,
    }
  })
}

export async function getBotStatusSnapshot(userId: string): Promise<{
  statusRow: BotStatusRow
  snapshot: BotStatusSnapshotData
}> {
  const [statusRow, sessionRows] = await Promise.all([
    db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, userId),
    }),
    db.query.botSessions.findMany({
      where: eq(botSessions.userId, userId),
      orderBy: (table, { desc }) => [desc(table.startedAt)],
      limit: 24,
    }),
  ])

  // Treat only explicitly running sessions as active markets.
  // Stopping sessions are draining and should not be shown as running markets.
  const activeMarketsSet = new Set<string>()
  for (const s of sessionRows) {
    if (s.status === 'running') {
      activeMarketsSet.add(s.market)
    }
  }

  const sessions = buildSessions(statusRow, sessionRows, activeMarketsSet)

  if (!statusRow) {
    return {
      statusRow,
      snapshot: {
        status: 'stopped',
        stopMode: null,
        activeMarkets: [],
        started_at: null,
        stopped_at: null,
        stopping_at: null,
        last_heartbeat: null,
        errorMessage: null,
        openTradeCount: 0,
        perMarketOpenTrades: {},
        timeoutWarning: false,
        sessions,
      },
    }
  }

  let openTradeCount = 0
  const perMarketOpenTrades: Record<string, number> = {}

  // Compute open trade counts for running, stopping, or stopped states
  // so UI can display open positions even after sessions are stopped.
  if (statusRow.status === 'stopping' || statusRow.status === 'running' || statusRow.status === 'stopped') {
    const [totalRows, marketRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(trades)
        .where(and(
          eq(trades.userId, userId),
          eq(trades.status, 'open' as any),
        )),
      db
        .select({
          marketType: trades.marketType,
          count: sql<number>`count(*)::int`,
        })
        .from(trades)
        .where(and(
          eq(trades.userId, userId),
          eq(trades.status, 'open' as any),
        ))
        .groupBy(trades.marketType),
    ])

    openTradeCount = totalRows[0]?.count ?? 0
    for (const row of marketRows) {
      perMarketOpenTrades[row.marketType] = row.count
    }
  }

  let timeoutWarning = false
  if (statusRow.status === 'stopping' && statusRow.stoppingAt) {
    const elapsedSeconds = (Date.now() - statusRow.stoppingAt.getTime()) / 1000
    const timeoutSeconds = statusRow.stopTimeoutSec ?? 300
    timeoutWarning = elapsedSeconds > timeoutSeconds
  }

  return {
    statusRow,
    snapshot: {
      status: statusRow.status,
      stopMode: statusRow.stopMode ?? null,
      activeMarkets: Array.from(activeMarketsSet),
      started_at: toUtcIsoString(statusRow.startedAt),
      stopped_at: toUtcIsoString(statusRow.stoppedAt),
      stopping_at: toUtcIsoString(statusRow.stoppingAt),
      last_heartbeat: toUtcIsoString(statusRow.lastHeartbeat),
      errorMessage: statusRow.errorMessage,
      openTradeCount,
      perMarketOpenTrades,
      timeoutWarning,
      sessions,
    },
  }
}
