import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses, exchangeApis } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const session = await auth()

  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { markets } = await req.json()

  if (!markets || markets.length === 0) {
    return NextResponse.json({ error: 'No markets specified' }, { status: 400 })
  }

  // ── Validate that an exchange API exists for EACH requested market ─────────
  const missingMarkets: string[] = []
  for (const market of markets) {
    const api = await db.query.exchangeApis.findFirst({
      where: and(
        eq(exchangeApis.userId, session.id),
        eq(exchangeApis.marketType, market as any),
        eq(exchangeApis.isActive, true),
      ),
    })

    if (!api) {
      missingMarkets.push(market)
    }
  }

  if (missingMarkets.length > 0) {
    return NextResponse.json(
      {
        error: `No exchange API configured for: ${missingMarkets.join(', ')}. Please add your API keys in Markets & APIs first.`,
        missingMarkets,
      },
      { status: 400 }
    )
  }

  // ── Call bot engine ────────────────────────────────────────────────────────
  let botRes: Response | null = null
  try {
    botRes = await fetch(`${process.env.BOT_ENGINE_URL}/bot/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
      },
      body: JSON.stringify({ user_id: session.id, markets }),
    })
  } catch (err) {
    console.error('Bot engine unreachable:', err)
    return NextResponse.json(
      { error: 'Bot engine is unreachable. Is the Render service running?' },
      { status: 503 }
    )
  }

  if (!botRes.ok) {
    const body = await botRes.json().catch(() => ({}))
    return NextResponse.json(
      { error: body.detail ?? 'Bot engine returned an error', detail: body },
      { status: botRes.status }
    )
  }

  // ── Persist running state in DB ────────────────────────────────────────────
  await db.insert(botStatuses)
    .values({
      userId:        session.id,
      status:        'running',
      activeMarkets: markets,
      startedAt:     new Date(),
    })
    .onConflictDoUpdate({
      target: botStatuses.userId,
      set: {
        status:        'running',
        activeMarkets: markets,
        startedAt:     new Date(),
        errorMessage:  null,
        updatedAt:     new Date(),
      },
    })

  return NextResponse.json({ success: true, status: 'running', markets })
}