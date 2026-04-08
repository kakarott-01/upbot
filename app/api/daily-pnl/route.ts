// app/api/daily-pnl/route.ts
//
// Returns per-day PnL breakdown plus principle/current-balance cards.
// Supports filters: ?market=crypto&mode=paper
//
// principle  = paper_balance from risk_settings (paper trades)
//              or 0 for live-only queries (user must top up manually)
// currentBal = principle + sum(net_pnl) of ALL matching closed trades

import { NextRequest, NextResponse } from 'next/server'
import { auth }         from '@/lib/auth'
import { db }           from '@/lib/db'
import { trades, riskSettings } from '@/lib/schema'
import { and, desc, eq, sql }   from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const market = searchParams.get('market') // all | indian | crypto | …
  const mode   = searchParams.get('mode')   // all | paper | live

  // ── Build filter conditions ───────────────────────────────────────────────
  const conditions = [
    eq(trades.userId, session.id),
    eq(trades.status, 'closed' as any),
  ]
  if (market && market !== 'all') conditions.push(eq(trades.marketType, market as any))
  if (mode === 'paper') conditions.push(eq(trades.isPaper, true))
  if (mode === 'live')  conditions.push(eq(trades.isPaper, false))

  // ── Run queries in parallel ───────────────────────────────────────────────
  const [dailyRows, settings, summaryRows] = await Promise.all([
    // Per-day breakdown (last 90 days, desc so newest first in UI)
    db
      .select({
        date:   sql<string>`date(closed_at)::text`,
        pnl:    sql<number>`coalesce(sum(coalesce(net_pnl, pnl)), 0)::float`,
        fees:   sql<number>`coalesce(sum(coalesce(fee_amount, 0)), 0)::float`,
        trades: sql<number>`count(*)::int`,
        wins:   sql<number>`count(*) filter (where coalesce(net_pnl, pnl) > 0)::int`,
        losses: sql<number>`count(*) filter (where coalesce(net_pnl, pnl) < 0)::int`,
      })
      .from(trades)
      .where(and(...conditions))
      .groupBy(sql`date(closed_at)`)
      .orderBy(desc(sql`date(closed_at)`))
      .limit(90),

    // Principle source
    db.query.riskSettings.findFirst({
      where: eq(riskSettings.userId, session.id),
      columns: { paperBalance: true },
    }),

    // All-time totals (under the current filter)
    db
      .select({
        totalPnl:  sql<number>`coalesce(sum(coalesce(net_pnl, pnl)), 0)::float`,
        totalFees: sql<number>`coalesce(sum(coalesce(fee_amount, 0)), 0)::float`,
        totalTrades: sql<number>`count(*)::int`,
      })
      .from(trades)
      .where(and(...conditions)),
  ])

  const principle      = Number(settings?.paperBalance ?? 10_000)
  const totalPnl       = summaryRows[0]?.totalPnl  ?? 0
  const totalFees      = summaryRows[0]?.totalFees ?? 0
  const totalTrades    = summaryRows[0]?.totalTrades ?? 0
  const currentBalance = principle + totalPnl

  // Today's numbers (first row from desc-sorted daily)
  const today    = new Date().toISOString().slice(0, 10)
  const todayRow = dailyRows.find(r => r.date === today)

  return NextResponse.json({
    principle:      Math.round(principle * 100) / 100,
    currentBalance: Math.round(currentBalance * 100) / 100,
    totalPnl:       Math.round(totalPnl * 100) / 100,
    totalFees:      Math.round(totalFees * 100) / 100,
    totalTrades,
    todayPnl:       Math.round((todayRow?.pnl ?? 0) * 100) / 100,
    todayTrades:    todayRow?.trades ?? 0,
    daily: dailyRows.map(r => ({
      ...r,
      pnl:  Math.round(r.pnl  * 100) / 100,
      fees: Math.round(r.fees * 100) / 100,
    })),
  })
}