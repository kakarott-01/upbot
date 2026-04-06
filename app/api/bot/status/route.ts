// app/api/bot/status/route.ts
// ===========================
// REVISED: Auto-detects graceful drain completion so the bot transitions
// to "stopped" the moment all positions close — without relying on the
// Python→Next.js HTTP callback (which can fail on Render cold starts).
//
// Also exposes stopMode, openTradeCount, stoppingAt, timeoutWarning,
// AND perMarketOpenTrades (new) so per-market stop modals show correct counts.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses, botSessions, killSwitchState, trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'
import { _doImmediateStop } from '@/lib/bot-stop'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [status, killSwitch, sessionRows] = await Promise.all([
    db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, session.id),
    }),
    db.query.killSwitchState.findFirst({
      where: eq(killSwitchState.userId, session.id),
    }),
    db.query.botSessions.findMany({
      where: eq(botSessions.userId, session.id),
      orderBy: (table, { desc }) => [desc(table.startedAt)],
      limit: 24,
    }),
  ])

  const latestSessionByMarket = new Map<string, (typeof sessionRows)[number]>()
  for (const row of sessionRows) {
    if (!latestSessionByMarket.has(row.market)) {
      latestSessionByMarket.set(row.market, row)
    }
  }
  const sessions = ['crypto', 'indian', 'global', 'commodities'].map((market) => {
    const row = latestSessionByMarket.get(market)
    const isActive = (status?.activeMarkets ?? []).includes(market)
    return {
      market,
      status: isActive ? 'running' : row?.status ?? 'stopped',
      sessionId: row?.id ?? null,
      mode: row?.mode ?? null,
      startedAt: isActive ? status?.startedAt ?? row?.startedAt ?? null : row?.startedAt ?? null,
      endedAt: isActive ? null : row?.endedAt ?? null,
      exchange: row?.exchange ?? null,
      openTrades: row?.openTrades ?? 0,
      totalTrades: row?.totalTrades ?? 0,
      totalPnl: row?.totalPnl ?? null,
      metadata: row?.metadata ?? null,
    }
  })

  if (!status) {
    return NextResponse.json({
      status:                'stopped',
      stopMode:              null,
      activeMarkets:         [],
      startedAt:             null,
      stoppingAt:            null,
      lastHeartbeat:         null,
      errorMessage:          null,
      openTradeCount:        0,
      perMarketOpenTrades:   {},
      timeoutWarning:        false,
      sessions,
      killSwitchActive:      false,
    })
  }

  // Count open trades for running or stopping states — both total AND per market
  let openTradeCount = 0
  const perMarketOpenTrades: Record<string, number> = {}

  if (status.status === 'stopping' || status.status === 'running') {
    // Total count
    const totalRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(
        eq(trades.userId, session.id),
        eq(trades.status, 'open' as any),
      ))
    openTradeCount = totalRows[0]?.count ?? 0

    // Per-market count — one query grouped by market_type
    const marketRows = await db
      .select({
        marketType: trades.marketType,
        count:      sql<number>`count(*)::int`,
      })
      .from(trades)
      .where(and(
        eq(trades.userId, session.id),
        eq(trades.status, 'open' as any),
      ))
      .groupBy(trades.marketType)

    for (const row of marketRows) {
      perMarketOpenTrades[row.marketType] = row.count
    }
  }

  // ── Auto-detect graceful drain completion ─────────────────────────────────
  if (
    status.status === 'stopping' &&
    status.stopMode === 'graceful' &&
    openTradeCount === 0
  ) {
    const now = new Date()
    try {
      await _doImmediateStop(session.id, now)
    } catch (e) {
      console.error('[bot/status] Auto-stop after drain failed:', e)
    }
    return NextResponse.json({
      status:              'stopped',
      stopMode:            null,
      activeMarkets:       [],
      startedAt:           status.startedAt,
      stoppingAt:          null,
      lastHeartbeat:       status.lastHeartbeat,
      errorMessage:        null,
      openTradeCount:      0,
      perMarketOpenTrades: {},
      timeoutWarning:      false,
      sessions:            sessions.map((item) => ({ ...item, status: 'stopped' })),
      killSwitchActive:    Boolean(killSwitch?.isActive),
    })
  }

  // Timeout warning: stopping has been active longer than stop_timeout_sec
  let timeoutWarning = false
  if (status.status === 'stopping' && status.stoppingAt) {
    const elapsedSec = (Date.now() - new Date(status.stoppingAt).getTime()) / 1000
    const timeout    = status.stopTimeoutSec ?? 300
    timeoutWarning   = elapsedSec > timeout
  }

  return NextResponse.json({
    status:              status.status,
    stopMode:            status.stopMode ?? null,
    activeMarkets:       status.activeMarkets ?? [],
    startedAt:           status.startedAt,
    stoppingAt:          (status as any).stoppingAt ?? null,
    lastHeartbeat:       status.lastHeartbeat,
    errorMessage:        status.errorMessage,
    openTradeCount,
    perMarketOpenTrades,
    timeoutWarning,
    sessions,
    killSwitchActive:    Boolean(killSwitch?.isActive),
  })
}