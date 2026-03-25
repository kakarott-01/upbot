import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const session = await auth()

  // ✅ FIXED
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await fetch(`${process.env.BOT_ENGINE_URL}/bot/stop`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
    },
    body: JSON.stringify({ user_id: session.id }),
  }).catch(() => null)

  await db.update(botStatuses)
    .set({
      status: 'stopped',
      stoppedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(botStatuses.userId, session.id))

  return NextResponse.json({ success: true, status: 'stopped' })
}