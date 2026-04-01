// app/api/bot/start/route.ts
// ==========================
// Bugs fixed:
// 1. Session rows are now created BEFORE the bot engine call. Previously they
//    were created after — if the engine call timed out (15s), bot_statuses
//    was set to 'running' but no session records existed, creating a phantom
//    "running" state. Now sessions are cleaned up on engine failure.
// 2. Session IDs are passed to the engine start request so the Python
//    scheduler can use the real DB session UUID as session_ref (for trade
//    ownership tracking in reconciliation).
// 3. Redis distributed lock prevents duplicate starts across serverless workers.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses, botSessions, exchangeApis, marketConfigs } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { acquireBotLock } from '@/lib/bot-lock'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Redis distributed lock ─────────────────────────────────────────────────
  const lock = await acquireBotLock(session.id, 'start')
  if (!lock.acquired) {
    return NextResponse.json({ error: lock.reason }, { status: 429 })
  }

  try {
    const { markets } = await req.json()
    if (!markets || markets.length === 0) {
      return NextResponse.json({ error: 'No markets specified' }, { status: 400 })
    }

    // ── Check if already running or stopping ──────────────────────────────────
    const existing = await db.query.botStatuses.findFirst({
      where: eq(botStatuses.userId, session.id),
      columns: { status: true },
    })

    if (existing?.status === 'running') {
      return NextResponse.json({ error: 'Bot is already running' }, { status: 409 })
    }

    if (existing?.status === 'stopping') {
      return NextResponse.json({
        error: 'Bot is currently stopping. Wait for it to finish before restarting.',
      }, { status: 409 })
    }

    // ── Close stale 'running' sessions from crashes ───────────────────────────
    await db
      .update(botSessions)
      .set({ status: 'stopped', endedAt: new Date() })
      .where(and(
        eq(botSessions.userId, session.id),
        eq(botSessions.status, 'running'),
      ))

    // ── Validate exchange APIs ────────────────────────────────────────────────
    const missingMarkets: string[] = []
    for (const market of markets) {
      const api = await db.query.exchangeApis.findFirst({
        where: and(
          eq(exchangeApis.userId, session.id),
          eq(exchangeApis.marketType, market as any),
          eq(exchangeApis.isActive, true),
        ),
      })
      if (!api) missingMarkets.push(market)
    }

    if (missingMarkets.length > 0) {
      return NextResponse.json(
        { error: `No exchange API configured for: ${missingMarkets.join(', ')}.`, missingMarkets },
        { status: 400 },
      )
    }

    const now = new Date()

    // ── Create sessions BEFORE calling the engine ─────────────────────────────
    // Bug fix: previously sessions were created after the engine call. If the
    // engine call timed out, bot_statuses was set to 'running' with no session
    // records, causing a phantom running state. Now we create sessions first
    // and clean them up if the engine call fails.
    const sessionIds: Record<string, string> = {}
    const createdSessionIds: string[] = []

    for (const market of markets) {
      const api = await db.query.exchangeApis.findFirst({
        where: and(
          eq(exchangeApis.userId, session.id),
          eq(exchangeApis.marketType, market as any),
          eq(exchangeApis.isActive, true),
        ),
        columns: { exchangeName: true },
      })

      const cfg = await db.query.marketConfigs.findFirst({
        where: and(
          eq(marketConfigs.userId, session.id),
          eq(marketConfigs.marketType, market as any),
        ),
        columns: { mode: true },
      })

      const [newSession] = await db.insert(botSessions).values({
        userId:    session.id,
        exchange:  api?.exchangeName ?? 'unknown',
        market,
        mode:      cfg?.mode ?? 'paper',
        status:    'running',
        startedAt: now,
      }).returning({ id: botSessions.id })

      sessionIds[market]    = newSession.id
      createdSessionIds.push(newSession.id)
    }

    // ── Call bot engine ───────────────────────────────────────────────────────
    let botRes: Response | null = null
    try {
      botRes = await fetch(`${process.env.BOT_ENGINE_URL}/bot/start`, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
        },
        // Pass session_ids so the Python scheduler uses real DB UUIDs as
        // session_ref for trade ownership tracking
        body:   JSON.stringify({ user_id: session.id, markets, session_ids: sessionIds }),
        signal: AbortSignal.timeout(15_000),
      })
    } catch (err) {
      console.error('Bot engine unreachable:', err)
      // Clean up the sessions we just created since the bot didn't start
      for (const sid of createdSessionIds) {
        await db.update(botSessions)
          .set({ status: 'stopped', endedAt: new Date() })
          .where(eq(botSessions.id, sid))
      }
      return NextResponse.json(
        { error: 'Bot engine is unreachable. Is the Render service running?' },
        { status: 503 },
      )
    }

    if (!botRes.ok) {
      const body = await botRes.json().catch(() => ({}))
      // Clean up sessions on engine error
      for (const sid of createdSessionIds) {
        await db.update(botSessions)
          .set({ status: 'stopped', endedAt: new Date() })
          .where(eq(botSessions.id, sid))
      }
      return NextResponse.json(
        { error: body.detail ?? 'Bot engine returned an error', detail: body },
        { status: botRes.status },
      )
    }

    // ── Persist running state ─────────────────────────────────────────────────
    await db.insert(botStatuses)
      .values({
        userId:        session.id,
        status:        'running',
        activeMarkets: markets,
        startedAt:     now,
        stopMode:      null,
        stoppingAt:    null,
      })
      .onConflictDoUpdate({
        target: botStatuses.userId,
        set: {
          status:        'running',
          activeMarkets: markets,
          startedAt:     now,
          errorMessage:  null,
          stopMode:      null,
          stoppingAt:    null,
          updatedAt:     now,
        },
      })

    return NextResponse.json({
      success: true,
      status:  'running',
      markets,
      sessionIds,
    })

  } finally {
    await lock.release()
  }
}