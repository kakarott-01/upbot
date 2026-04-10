// app/api/trades/route.ts
//
// PERFORMANCE: All 3 DB calls now run in parallel via Promise.all
// instead of sequentially. On Neon this saves ~2 round-trips per page load.
//
// Add the composite index below in Neon SQL editor for 10-50× faster
// filtered queries at scale (run once, no downtime):
//
//   CREATE INDEX CONCURRENTLY idx_trades_user_status_opened
//     ON trades(user_id, status, opened_at DESC);

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { eq, desc, and, gte, sql } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const { searchParams } = new URL(req.url)

  // ── Pagination ────────────────────────────────────────────────────────────
  const page   = Math.max(1, Number(searchParams.get('page') ?? 1))
  const limit  = Math.min(Number(searchParams.get('limit') ?? 50), 500)
  const offset = (page - 1) * limit

  // ── Filters ───────────────────────────────────────────────────────────────
  const market = searchParams.get('market')
  const status = searchParams.get('status')
  const mode   = searchParams.get('mode')
  const since  = searchParams.get('since')

  const conditions = [eq(trades.userId, session.id)]

  if (market && market !== 'all') conditions.push(eq(trades.marketType, market as any))
  if (status && status !== 'all') conditions.push(eq(trades.status, status as any))
  if (since)                      conditions.push(gte(trades.openedAt, new Date(since)))
  if (mode === 'paper') conditions.push(eq(trades.isPaper, true))
  if (mode === 'live')  conditions.push(eq(trades.isPaper, false))

  // ── All 3 queries run in parallel — saves ~2 Neon round-trips ─────────────
  const [result, countRows, summaryRows] = await Promise.all([
    db.query.trades.findMany({
      where:   and(...conditions),
      orderBy: [desc(trades.openedAt)],
      limit,
      offset,
    }),
    db.select({ count: sql<number>`count(*)::int` })
      .from(trades)
      .where(and(...conditions)),
    db.select({
      closed:   sql<number>`count(*) filter (where status = 'closed')::int`,
      winners:  sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0)::int`,
      totalPnl: sql<number>`coalesce(sum(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
      totalFees: sql<number>`coalesce(sum(coalesce(fee_amount, 0)) filter (where status = 'closed'), 0)::float`,
    })
      .from(trades)
      .where(and(...conditions)),
  ])

  const s       = summaryRows[0]
  const winRate = s.closed > 0 ? (s.winners / s.closed) * 100 : 0
  const total   = countRows[0]?.count ?? 0

  const res = NextResponse.json({
    trades: result,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasMore: offset + result.length < total,
    },
    summary: {
      total,
      closed:   s.closed,
      totalPnl: Math.round((s.totalPnl ?? 0) * 100) / 100,
      totalFees: Math.round((s.totalFees ?? 0) * 100) / 100,
      winRate:  Math.round(winRate * 10) / 10,
    },
  })

  return res
}
