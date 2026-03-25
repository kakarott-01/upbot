import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { eq, desc, and, gte } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await auth()

  // ✅ FIX
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)

  const limit = Math.min(Number(searchParams.get('limit') ?? 50), 200)
  const market = searchParams.get('market')
  const status = searchParams.get('status')
  const since = searchParams.get('since')

  const conditions = [eq(trades.userId, session.id)]

  if (market) conditions.push(eq(trades.marketType, market as any))
  if (status) conditions.push(eq(trades.status, status as any))
  if (since) conditions.push(gte(trades.openedAt, new Date(since)))

  const result = await db.query.trades.findMany({
    where: and(...conditions),
    orderBy: [desc(trades.openedAt)],
    limit,
  })

  const closed = result.filter(t => t.status === 'closed')
  const totalPnl = closed.reduce((sum, t) => sum + Number(t.pnl ?? 0), 0)
  const winCount = closed.filter(t => Number(t.pnl ?? 0) > 0).length
  const winRate = closed.length > 0 ? (winCount / closed.length) * 100 : 0

  return NextResponse.json({
    trades: result,
    summary: {
      total: result.length,
      closed: closed.length,
      totalPnl,
      winRate: Math.round(winRate * 10) / 10,
    },
  })
}