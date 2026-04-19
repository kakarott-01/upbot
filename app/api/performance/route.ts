// app/api/performance/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { backtestRuns, trades, riskSettings } from '@/lib/schema'
import { eq, and, sql, gte } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

const VALID_MARKETS = new Set(['indian', 'crypto', 'commodities', 'global', 'all'])
const VALID_MODES = new Set(['paper', 'live', 'all'])

export const maxDuration = 10

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const { searchParams } = new URL(req.url)
  const mode   = searchParams.get('mode')   // paper | live | all
  const market = searchParams.get('market') // indian | crypto | commodities | global | all

  if (mode && !VALID_MODES.has(mode)) {
    return NextResponse.json({ error: 'Invalid mode filter' }, { status: 400 })
  }

  if (market && !VALID_MARKETS.has(market)) {
    return NextResponse.json({ error: 'Invalid market filter' }, { status: 400 })
  }

  const conditions = [eq(trades.userId, session.id)]
  if (mode === 'paper') conditions.push(eq(trades.isPaper, true))
  if (mode === 'live')  conditions.push(eq(trades.isPaper, false))
  if (market && market !== 'all') conditions.push(eq(trades.marketType, market as any))

  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const closedConditions = [...conditions, eq(trades.status, 'closed' as any)]

  // ── Cumulative P&L series (for chart) ─────────────────────────────────────
  // Bound the dataset so a long-lived account cannot blow up a serverless
  // response or the client chart. Aggregate by day to preserve cumulative
  // accuracy while keeping the payload compact.
  const oneYearAgo = new Date()
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const [
    summaryRows,
    dailyPnl,
    settings,
    totals,
    byMarket,
    closedTradeDays,
    byStrategy,
    latestBacktests,
  ] = await Promise.all([
    db
      .select({
        total:       sql<number>`count(*)::int`,
        open:        sql<number>`count(*) filter (where status = 'open')::int`,
        closed:      sql<number>`count(*) filter (where status = 'closed')::int`,
        winners:     sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0)::int`,
        losers:      sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) <= 0)::int`,
        totalPnl:    sql<number>`coalesce(sum(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
        totalFees:   sql<number>`coalesce(sum(coalesce(fee_amount, 0)) filter (where status = 'closed'), 0)::float`,
        avgWin:      sql<number>`coalesce(avg(coalesce(net_pnl, pnl)) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0), 0)::float`,
        avgLoss:     sql<number>`coalesce(avg(coalesce(net_pnl, pnl)) filter (where status = 'closed' and coalesce(net_pnl, pnl) <= 0), 0)::float`,
        bestTrade:   sql<number>`coalesce(max(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
        worstTrade:  sql<number>`coalesce(min(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
        paperCount:  sql<number>`count(*) filter (where is_paper = true)::int`,
        liveCount:   sql<number>`count(*) filter (where is_paper = false)::int`,
      })
      .from(trades)
      .where(and(...conditions)),
    db
      .select({
        date: sql<string>`date(closed_at)::text`,
        pnl:  sql<number>`coalesce(sum(coalesce(net_pnl, pnl)), 0)::float`,
        wins: sql<number>`count(*) filter (where coalesce(net_pnl, pnl) > 0)::int`,
        losses: sql<number>`count(*) filter (where coalesce(net_pnl, pnl) <= 0)::int`,
      })
      .from(trades)
      .where(and(
        ...conditions,
        eq(trades.status, 'closed' as any),
        gte(trades.closedAt, thirtyDaysAgo),
      ))
      .groupBy(sql`date(closed_at)`)
      .orderBy(sql`date(closed_at) asc`),
    db.query.riskSettings.findFirst({
      where: eq(riskSettings.userId, session.id),
      columns: { paperBalance: true },
    }),
    db
      .select({
        totalPnl:  sql<number>`coalesce(sum(coalesce(net_pnl, pnl)), 0)::float`,
        totalFees: sql<number>`coalesce(sum(coalesce(fee_amount, 0)), 0)::float`,
        totalTrades: sql<number>`count(*)::int`,
      })
      .from(trades)
      .where(and(...closedConditions)),
    db
      .select({
        market:  trades.marketType,
        total:   sql<number>`count(*)::int`,
        closed:  sql<number>`count(*) filter (where status = 'closed')::int`,
        winners: sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0)::int`,
        pnl:     sql<number>`coalesce(sum(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
        fees:    sql<number>`coalesce(sum(coalesce(fee_amount, 0)) filter (where status = 'closed'), 0)::float`,
      })
      .from(trades)
      .where(and(...conditions))
      .groupBy(trades.marketType),
    db
      .select({
        date: sql<string>`date(closed_at)::text`,
        pnl: sql<number>`coalesce(sum(coalesce(net_pnl, pnl)), 0)::float`,
      })
      .from(trades)
      .where(and(
        ...conditions,
        eq(trades.status, 'closed' as any),
        gte(trades.closedAt, oneYearAgo),
      ))
      .groupBy(sql`date(closed_at)`)
      .orderBy(sql`date(closed_at)`),
    db
      .select({
        strategyKey: trades.strategyKey,
        market: trades.marketType,
        total: sql<number>`count(*)::int`,
        closed: sql<number>`count(*) filter (where status = 'closed')::int`,
        winners: sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0)::int`,
        pnl: sql<number>`coalesce(sum(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
        unrealizedPnl: sql<number>`coalesce(sum(
          case when status = 'open' then coalesce(net_pnl, pnl, 0) else 0 end
        ), 0)::float`,
      })
      .from(trades)
      .where(and(...conditions, sql`${trades.strategyKey} is not null`))
      .groupBy(trades.strategyKey, trades.marketType),
    db.query.backtestRuns.findMany({
      where: eq(backtestRuns.userId, session.id),
      orderBy: (table, { desc }) => [desc(table.completedAt), desc(table.createdAt)],
      columns: {
        marketType: true,
        strategyKeys: true,
        performanceMetrics: true,
        completedAt: true,
      },
      limit: 50,
    }),
  ])

  const summary = summaryRows[0] ?? {
    total: 0,
    open: 0,
    closed: 0,
    winners: 0,
    losers: 0,
    totalPnl: 0,
    totalFees: 0,
    avgWin: 0,
    avgLoss: 0,
    bestTrade: 0,
    worstTrade: 0,
    paperCount: 0,
    liveCount: 0,
  }

  const winRate    = summary.closed > 0 ? (summary.winners / summary.closed) * 100 : 0
  const riskReward = summary.avgLoss !== 0 ? Math.abs(summary.avgWin / summary.avgLoss) : 0

  let cumulative = 0
  const cumPnl = closedTradeDays.map(t => {
    cumulative += t.pnl ?? 0
    return {
      date: t.date,
      pnl:  Math.round(cumulative * 100) / 100,
    }
  })

  // Default paper balance varies by market currency: crypto/global use smaller units (100),
  // Indian/commodities use larger units (10,000).
  const defaultPaperBalance = (market === 'crypto' || market === 'global') ? 100 : 10_000
  const principle = Number(settings?.paperBalance ?? defaultPaperBalance)
  const currentBalance = principle + (totals[0]?.totalPnl ?? 0)
  const totalFees = totals[0]?.totalFees ?? 0

  const backtestByKey = new Map<string, any>()
  for (const run of latestBacktests) {
    for (const strategyKey of run.strategyKeys ?? []) {
      const key = `${run.marketType}:${strategyKey}`
      if (!backtestByKey.has(key)) {
        backtestByKey.set(key, {
          metrics: run.performanceMetrics ?? null,
          completedAt: run.completedAt,
        })
      }
    }
  }

  return NextResponse.json({
    summary: {
      total:       summary.total,
      open:        summary.open,
      closed:      summary.closed,
      winners:     summary.winners,
      losers:      summary.losers,
      totalPnl:    Math.round(summary.totalPnl * 100) / 100,
      totalFees:   Math.round(summary.totalFees * 100) / 100,
      avgWin:      Math.round(summary.avgWin * 100) / 100,
      avgLoss:     Math.round(summary.avgLoss * 100) / 100,
      bestTrade:   Math.round(summary.bestTrade * 100) / 100,
      worstTrade:  Math.round(summary.worstTrade * 100) / 100,
      winRate:     Math.round(winRate * 10) / 10,
      riskReward:  Math.round(riskReward * 100) / 100,
      paperCount:  summary.paperCount,
      liveCount:   summary.liveCount,
    },
    dailyPnl,
    principle: Math.round(principle * 100) / 100,
    currentBalance: Math.round(currentBalance * 100) / 100,
    totalFees: Math.round(totalFees * 100) / 100,
    totalTrades: totals[0]?.totalTrades ?? 0,
    byMarket,
    byStrategy: byStrategy.map((row) => ({
      ...row,
      strategyKey: row.strategyKey,
      winRate: row.closed > 0 ? Math.round((row.winners / row.closed) * 10000) / 100 : 0,
      liveVsBacktest: backtestByKey.get(`${row.market}:${row.strategyKey}`) ?? null,
    })),
    cumPnl,
  })
}
