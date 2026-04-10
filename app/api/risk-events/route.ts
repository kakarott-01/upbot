import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { blockedTrades, riskEvents } from '@/lib/schema'
import { desc, eq } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET() {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

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
