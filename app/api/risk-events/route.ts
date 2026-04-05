import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { blockedTrades, riskEvents } from '@/lib/schema'
import { desc, eq } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [events, blocked] = await Promise.all([
    db.query.riskEvents.findMany({
      where: eq(riskEvents.userId, session.id),
      orderBy: (table) => [desc(table.createdAt)],
      limit: 50,
    }),
    db.query.blockedTrades.findMany({
      where: eq(blockedTrades.userId, session.id),
      orderBy: (table) => [desc(table.createdAt)],
      limit: 50,
    }),
  ])

  return NextResponse.json({ events, blockedTrades: blocked })
}
