// app/api/bot-history/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botSessions, trades } from '@/lib/schema'
import { eq, desc, and, gte, lte, sql } from 'drizzle-orm'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const mode     = searchParams.get('mode')      // paper | live
  const exchange = searchParams.get('exchange')
  const from     = searchParams.get('from')       // ISO date string
  const to       = searchParams.get('to')         // ISO date string
  const page     = Math.max(1, Number(searchParams.get('page') ?? 1))
  const limit    = Math.min(Number(searchParams.get('limit') ?? 20), 100)
  const offset   = (page - 1) * limit

  const conditions = [eq(botSessions.userId, session.id)]
  if (mode === 'paper' || mode === 'live') conditions.push(eq(botSessions.mode, mode))
  if (exchange) conditions.push(eq(botSessions.exchange, exchange))
  if (from)     conditions.push(gte(botSessions.startedAt, new Date(from)))
  if (to)       conditions.push(lte(botSessions.startedAt, new Date(to)))

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

  return NextResponse.json({
    sessions: rows,
    pagination: {
      page,
      limit,
      total: countRows[0]?.count ?? 0,
      pages: Math.ceil((countRows[0]?.count ?? 0) / limit),
    },
  })
}