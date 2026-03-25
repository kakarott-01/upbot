import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses, exchangeApis } from '@/lib/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const session = await auth()

  // ✅ FIXED
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { markets } = await req.json()

  for (const market of markets) {
    const api = await db.query.exchangeApis.findFirst({
      where: eq(exchangeApis.userId, session.id),
    })

    if (!api) {
      return NextResponse.json(
        { error: `No exchange API configured for ${market}` },
        { status: 400 }
      )
    }
  }

  const botRes = await fetch(`${process.env.BOT_ENGINE_URL}/bot/start`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
    },
    body: JSON.stringify({ user_id: session.id, markets }),
  }).catch(() => null)

  if (!botRes?.ok) {
    return NextResponse.json({ error: 'Bot engine unavailable' }, { status: 503 })
  }

  await db.insert(botStatuses)
    .values({
      userId: session.id,
      status: 'running',
      activeMarkets: markets,
      startedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: botStatuses.userId,
      set: {
        status: 'running',
        activeMarkets: markets,
        startedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      },
    })

  return NextResponse.json({ success: true, status: 'running' })
}