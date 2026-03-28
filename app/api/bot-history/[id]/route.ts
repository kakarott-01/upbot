// app/api/bot-history/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botSessions } from '@/lib/schema'
import { and, eq } from 'drizzle-orm'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const existing = await db.query.botSessions.findFirst({
    where: and(
      eq(botSessions.id, params.id),
      eq(botSessions.userId, session.id),
    ),
  })

  if (!existing) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  }

  await db.delete(botSessions)
    .where(and(
      eq(botSessions.id, params.id),
      eq(botSessions.userId, session.id),
    ))

  return NextResponse.json({ success: true })
}