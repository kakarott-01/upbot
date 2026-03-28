import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Single aggregation query — no row limit, always reflects true totals
  const rows = await db
    .select({
      total:      sql<number>`count(*)::int`,
      closed:     sql<number>`count(*) filter (where status = 'closed')::int`,
      winners:    sql<number>`count(*) filter (where status = 'closed' and pnl > 0)::int`,
      totalPnl:   sql<number>`coalesce(sum(pnl) filter (where status = 'closed'), 0)::float`,
      avgWin:     sql<number>`coalesce(avg(pnl) filter (where status = 'closed' and pnl > 0), 0)::float`,
      avgLoss:    sql<number>`coalesce(avg(pnl) filter (where status = 'closed' and pnl <= 0), 0)::float`,
    })
    .from(trades)
    .where(eq(trades.userId, session.id))

  const row = rows[0]
  const winRate = row.closed > 0 ? (row.winners / row.closed) * 100 : 0

  return NextResponse.json({
    total:     row.total,
    closed:    row.closed,
    totalPnl:  row.totalPnl,
    winRate:   Math.round(winRate * 10) / 10,
    avgWin:    row.avgWin,
    avgLoss:   row.avgLoss,
  })
}