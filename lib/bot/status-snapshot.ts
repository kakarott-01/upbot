import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { botSessions, botStatuses, killSwitchState, trades } from '@/lib/schema'
import { toUtcIsoString } from '@/lib/time'

const BOT_MARKETS = ['crypto', 'indian', 'global', 'commodities'] as const

type BotStatusRow = Awaited<ReturnType<typeof db.query.botStatuses.findFirst>>
type BotSessionRow = Awaited<ReturnType<typeof db.query.botSessions.findMany>>[number]

function buildSessions(statusRow: BotStatusRow, sessionRows: BotSessionRow[]) {
  const latestSessionByMarket = new Map<string, BotSessionRow>()

  for (const row of sessionRows) {
    if (!latestSessionByMarket.has(row.market)) {
      latestSessionByMarket.set(row.market, row)
    }
  }

  return BOT_MARKETS.map((market) => {
    const row = latestSessionByMarket.get(market)
    const isActive = (statusRow?.activeMarkets ?? []).includes(market)

    return {
      market,
      status: isActive ? 'running' : row?.status ?? 'stopped',
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

export async function getBotStatusSnapshot(userId: string) {
  const [statusRow, killSwitch, sessionRows] = await Promise.all([
    db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, userId),
    }),
    db.query.killSwitchState.findFirst({
      where: eq(killSwitchState.userId, userId),
    }),
    db.query.botSessions.findMany({
      where: eq(botSessions.userId, userId),
      orderBy: (table, { desc }) => [desc(table.startedAt)],
      limit: 24,
    }),
  ])

  const sessions = buildSessions(statusRow, sessionRows)

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
        killSwitchActive: Boolean(killSwitch?.isActive),
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
      activeMarkets: statusRow.activeMarkets ?? [],
      started_at: toUtcIsoString(statusRow.startedAt),
      stopped_at: toUtcIsoString(statusRow.stoppedAt),
      stopping_at: toUtcIsoString(statusRow.stoppingAt),
      last_heartbeat: toUtcIsoString(statusRow.lastHeartbeat),
      errorMessage: statusRow.errorMessage,
      openTradeCount,
      perMarketOpenTrades,
      timeoutWarning,
      sessions,
      killSwitchActive: Boolean(killSwitch?.isActive),
    },
  }
}
