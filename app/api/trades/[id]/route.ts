// app/api/trades/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { trades } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await db.query.trades.findFirst({
    where: and(eq(trades.id, params.id), eq(trades.userId, session.id)),
  })

  if (!existing) return NextResponse.json({ error: 'Trade not found' }, { status: 404 })

  await db.delete(trades).where(and(eq(trades.id, params.id), eq(trades.userId, session.id)))

  return NextResponse.json({ success: true })
}