// app/api/bot/stop-market/route.ts
// ===================================
// Handles stopping a single market while keeping others running.
//
// POST { marketType: string, mode: 'graceful' | 'close_all' }
//
// graceful: removes market from active scheduler, lets open positions
//           remain until they exit naturally (unmonitored).
//
// close_all: removes market from scheduler AND triggers close-all for
//            open positions in that market. Uses the engine's close-all
//            which closes ALL open positions for the user — the caller
//            must ensure other markets have no positions they want to keep,
//            or accept that close-all is market-scoped at engine level.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { botStatuses, botSessions, trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'

const schema = z.object({
  marketType: z.enum(['indian', 'crypto', 'commodities', 'global']),
  mode: z.enum(['graceful', 'close_all']),
})

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { marketType, mode } = parsed.data

  const current = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, session.id),
    columns: { status: true, activeMarkets: true },
  })

  if (!current || current.status === 'stopped') {
    return NextResponse.json({ error: 'Bot is not running' }, { status: 409 })
  }

  const activeMarkets = (current.activeMarkets as string[] ?? [])
  if (!activeMarkets.includes(marketType)) {
    return NextResponse.json({ error: `${marketType} is not currently active` }, { status: 409 })
  }

  const remainingMarkets = activeMarkets.filter((m) => m !== marketType)
  const now = new Date()

  // Count open trades for this specific market
  const [openRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(
      eq(trades.userId, session.id),
      eq(trades.marketType, marketType as any),
      eq(trades.status, 'open' as any),
    ))
  const openCount = openRows?.count ?? 0

  // ── Sync engine: remove this market from the scheduler ──────────────────
  // Whether drain or close_all, we always remove the market from the active list.
  // For close_all we then also trigger position closing.

  if (remainingMarkets.length === 0) {
    // Last market — do a full bot stop instead
    await db
      .update(botStatuses)
      .set({
        status: mode === 'close_all' ? 'stopping' as any : 'stopped' as any,
        activeMarkets: [],
        stopMode: mode === 'close_all' ? 'close_all' : null,
        stoppingAt: mode === 'close_all' ? now : null,
        updatedAt: now,
      })
      .where(eq(botStatuses.userId, session.id))
  } else {
    // Keep other markets running
    await db
      .update(botStatuses)
      .set({
        activeMarkets: remainingMarkets,
        updatedAt: now,
      })
      .where(eq(botStatuses.userId, session.id))
  }

  // Mark the session for this market as stopped
  const runningSessions = await db.query.botSessions.findMany({
    where: and(
      eq(botSessions.userId, session.id),
      eq(botSessions.market, marketType),
      eq(botSessions.status, 'running'),
    ),
  })

  for (const s of runningSessions) {
    try {
      const stats = await db
        .select({
          total:  sql<number>`count(*)::int`,
          open:   sql<number>`count(*) filter (where status = 'open')::int`,
          closed: sql<number>`count(*) filter (where status = 'closed')::int`,
          pnl:    sql<number>`coalesce(sum(pnl) filter (where status = 'closed'), 0)::float`,
        })
        .from(trades)
        .where(and(
          eq(trades.userId, session.id),
          eq(trades.marketType, marketType as any),
          s.startedAt ? sql`${trades.openedAt} >= ${s.startedAt}` : sql`true`,
        ))

      const row = stats[0]
      await db.update(botSessions)
        .set({
          status: 'stopped',
          endedAt: now,
          totalTrades: row?.total ?? 0,
          openTrades: mode === 'close_all' ? 0 : (row?.open ?? 0),
          closedTrades: row?.closed ?? 0,
          totalPnl: String(row?.pnl ?? 0),
        })
        .where(eq(botSessions.id, s.id))
    } catch (err) {
      console.error(`[stop-market] Session update failed for ${s.id}:`, err)
    }
  }

  // ── Notify bot engine ───────────────────────────────────────────────────
  try {
    if (mode === 'close_all' && openCount > 0) {
      // Trigger close-all for this market's positions
      // The engine's close-all accepts a market_type filter via the new endpoint
      await fetch(`${process.env.BOT_ENGINE_URL}/bot/close-market`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
        },
        body: JSON.stringify({ user_id: session.id, market_type: marketType }),
        signal: AbortSignal.timeout(8_000),
      }).catch(() => {
        // Fallback: use generic close-all if market-specific endpoint not available
        return fetch(`${process.env.BOT_ENGINE_URL}/bot/close-all`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
          },
          body: JSON.stringify({ user_id: session.id }),
          signal: AbortSignal.timeout(8_000),
        })
      })
    }

    // Always sync the scheduler to remove this market's jobs
    if (remainingMarkets.length > 0) {
      await fetch(`${process.env.BOT_ENGINE_URL}/bot/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
        },
        body: JSON.stringify({ user_id: session.id, markets: remainingMarkets }),
        signal: AbortSignal.timeout(8_000),
      })
    } else {
      await fetch(`${process.env.BOT_ENGINE_URL}/bot/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
        },
        body: JSON.stringify({ user_id: session.id }),
        signal: AbortSignal.timeout(8_000),
      })
    }
  } catch (err) {
    console.warn(`[stop-market] Engine notify failed (non-fatal):`, err)
  }

  return NextResponse.json({
    success: true,
    stoppedMarket: marketType,
    mode,
    remainingMarkets,
    openPositionsClosed: mode === 'close_all' ? openCount : 0,
  })
}