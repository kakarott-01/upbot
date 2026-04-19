// app/api/bot-history/route.ts — v3
// =====================================
// FIX: Added endedAt upper bound to trade counting SQL.
//
// ROOT CAUSE OF MISALIGNMENT:
//   Previous query: WHERE openedAt >= session.startedAt
//   This means session A (start T1) and session B (start T2 > T1) BOTH count
//   any trade opened at T1 < openedAt < T2, because both sessions have
//   openedAt >= their respective startedAt satisfied.
//   Session A would accumulate trades from ALL subsequent sessions, inflating counts.
//
// FIX:
//   Add: AND openedAt < session.endedAt (or NOW() for in-progress sessions)
//   This ensures each trade is counted only in the session it was opened during.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { botStatuses, botSessions, trades } from '@/lib/schema'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'
import { toUtcIsoString } from '@/lib/time'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { boundedIntParam, dateParam } from '@/lib/api-params'
import { redis } from '@/lib/redis'

export const maxDuration = 10

// ── Inline cleanup: close stale 'running' sessions if bot is stopped ─────────

async function closeStaleSessions(userId: string): Promise<void> {
  try {
    const status = await db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, userId),
      columns: { status: true },
    })

    const shouldClean =
      !status ||
      status.status === 'stopped' ||
      status.status === 'stopping'

    if (!shouldClean) return

    const stale = await db.query.botSessions.findMany({
      where: and(
        eq(botSessions.userId, userId),
        eq(botSessions.status, 'running'),
      ),
    })

    if (stale.length === 0) return

    const now = new Date()
    const allStats = await db
      .select({
        market: trades.marketType,
        total:  sql<number>`count(*)::int`,
        open:   sql<number>`count(*) filter (where status = 'open')::int`,
        closed: sql<number>`count(*) filter (where status = 'closed')::int`,
        pnl:    sql<number>`coalesce(sum(pnl) filter (where status = 'closed'), 0)::float`,
      })
      .from(trades)
      .where(and(
        eq(trades.userId, userId),
        sql`${trades.openedAt} <= ${now}`,
      ))
      .groupBy(trades.marketType)

    const statsByMarket = new Map(allStats.map((row) => [row.market, row]))
    const emptyStats = { total: 0, open: 0, closed: 0, pnl: 0 }

    await Promise.all(stale.map(async (s) => {
      const row = statsByMarket.get(s.market as (typeof allStats)[number]['market']) ?? emptyStats

      try {
        await db.update(botSessions)
          .set({
            status:       'stopped',
            endedAt:      now,
            totalTrades:  row.total,
            openTrades:   row.open,
            closedTrades: row.closed,
            totalPnl:     String(row.pnl),
          })
          .where(eq(botSessions.id, s.id))
      } catch (err) {
        console.error(`[bot-history] Stale session cleanup failed for session ${s.id}:`, err)
      }
    }))
  } catch (err) {
    console.error('[bot-history] Inline cleanup failed (non-fatal):', err)
  }
}

async function shouldRunCleanup(userId: string): Promise<boolean> {
  const cleanupKey = `bot_history_cleanup:${userId}`

  try {
    const recentlyCleaned = await redis.get(cleanupKey)
    if (recentlyCleaned) return false

    await redis.set(cleanupKey, '1', { ex: 60 })
    return true
  } catch (err) {
    console.error('[bot-history] Cleanup throttle failed; proceeding with cleanup:', err)
    return true
  }
}

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  if (await shouldRunCleanup(session.id)) {
    await closeStaleSessions(session.id)
  }

  const { searchParams } = new URL(req.url)
  const mode     = searchParams.get('mode')
  const exchange = searchParams.get('exchange')
  const from     = searchParams.get('from')
  const to       = searchParams.get('to')
  const page     = boundedIntParam(searchParams.get('page'), 1)
  const limit    = boundedIntParam(searchParams.get('limit'), 20, { min: 1, max: 100 })
  const offset   = (page - 1) * limit
  const fromDate = dateParam(from)
  const toDate   = dateParam(to)

  if (from && !fromDate) {
    return NextResponse.json({ error: 'Invalid from date filter' }, { status: 400 })
  }

  if (to && !toDate) {
    return NextResponse.json({ error: 'Invalid to date filter' }, { status: 400 })
  }

  const conditions = [eq(botSessions.userId, session.id)]
  if (mode === 'paper' || mode === 'live') conditions.push(eq(botSessions.mode, mode))
  if (exchange) conditions.push(eq(botSessions.exchange, exchange))
  if (fromDate) conditions.push(gte(botSessions.startedAt, fromDate))
  if (toDate)   conditions.push(lte(botSessions.startedAt, toDate))

  const [rows, countRows] = await Promise.all([
    db.query.botSessions.findMany({
      where:   and(...conditions),
      orderBy: [desc(botSessions.startedAt)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` })
      .from(botSessions)
      .where(and(...conditions)),
  ])

  // For sessions still running: enrich with live trade count, bounded correctly
  const enriched = await Promise.all(rows.map(async (s) => {
    if (s.status !== 'running') return s

    try {
      const now = new Date()
      const stats = await db
        .select({
          total:  sql<number>`count(*)::int`,
          open:   sql<number>`count(*) filter (where status = 'open')::int`,
          closed: sql<number>`count(*) filter (where status = 'closed')::int`,
          pnl:    sql<number>`coalesce(sum(pnl) filter (where status = 'closed'), 0)::float`,
        })
        .from(trades)
        .where(and(
          eq(trades.userId, session.id),
          eq(trades.marketType, s.market as any),
          s.startedAt
            ? sql`${trades.openedAt} >= ${s.startedAt}`
            : sql`true`,
          // Upper bound for running sessions: now
          sql`${trades.openedAt} <= ${now}`,
        ))

      const row = stats[0]
      return {
        ...s,
        totalTrades:  row?.total  ?? 0,
        openTrades:   row?.open   ?? 0,
        closedTrades: row?.closed ?? 0,
        totalPnl:     String(row?.pnl ?? 0),
      }
    } catch (err) {
      console.error(`[bot-history] Enrichment failed for session ${s.id}:`, err)
      return s
    }
  }))

  return NextResponse.json({
    sessions: enriched.map((s) => ({
      id:           s.id,
      exchange:     s.exchange,
      market:       s.market,
      mode:         s.mode,
      status:       s.status,
      started_at:   toUtcIsoString(s.startedAt),
      stopped_at:   toUtcIsoString(s.endedAt),
      totalTrades:  s.totalTrades,
      openTrades:   s.openTrades,
      closedTrades: s.closedTrades,
      totalPnl:     s.totalPnl,
      errorMessage: s.errorMessage,
      metadata:     s.metadata,
    })),
    pagination: {
      page,
      limit,
      total: countRows[0]?.count ?? 0,
      pages: Math.ceil((countRows[0]?.count ?? 0) / limit),
    },
  })
}
