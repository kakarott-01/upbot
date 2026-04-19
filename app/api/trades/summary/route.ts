import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export const maxDuration = 10

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  // Single aggregation query — no row limit, always reflects true totals
  const rows = await db
    .select({
      total:      sql<number>`count(*)::int`,
      closed:     sql<number>`count(*) filter (where status = 'closed')::int`,
      winners:    sql<number>`count(*) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0)::int`,
      totalPnl:   sql<number>`coalesce(sum(coalesce(net_pnl, pnl)) filter (where status = 'closed'), 0)::float`,
      totalFees:  sql<number>`coalesce(sum(coalesce(fee_amount, 0)) filter (where status = 'closed'), 0)::float`,
      avgWin:     sql<number>`coalesce(avg(coalesce(net_pnl, pnl)) filter (where status = 'closed' and coalesce(net_pnl, pnl) > 0), 0)::float`,
      avgLoss:    sql<number>`coalesce(avg(coalesce(net_pnl, pnl)) filter (where status = 'closed' and coalesce(net_pnl, pnl) <= 0), 0)::float`,
    })
    .from(trades)
    .where(eq(trades.userId, session.id))

  const row = rows[0]
  const winRate = row.closed > 0 ? (row.winners / row.closed) * 100 : 0

  return NextResponse.json({
    total:     row.total,
    closed:    row.closed,
    totalPnl:  row.totalPnl,
    totalFees: row.totalFees,
    winRate:   Math.round(winRate * 10) / 10,
    avgWin:    row.avgWin,
    avgLoss:   row.avgLoss,
  })
}
