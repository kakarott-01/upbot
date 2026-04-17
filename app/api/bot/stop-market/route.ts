// app/api/bot/stop-market/route.ts — v2
// =========================================
// FIX 1: Graceful drain for last market with open trades.
//   Previous bug: mode=graceful + last market always set status='stopped'
//   regardless of open trades, so the bot stopped without draining.
//   Fix: if graceful + open trades + last market → status='stopping' with stopMode='graceful'.
//
// FIX 2: Implement close_all per market.
//   Previous: returned 400 "not supported". Now: immediately stops the market
//   (removes from activeMarkets, stops session), notifies engine to sync.
//   Positions become unmonitored — user must close manually on exchange.
//   A warning is included in the response.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { botStatuses, botSessions, trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'
import { z } from 'zod'
import { getBotStatusSnapshot } from '@/lib/bot/status-snapshot'
import { acquireBotLock } from '@/lib/bot-lock'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { postToBotEngine } from '@/lib/bot-engine-client'

const schema = z.object({
  marketType: z.enum(['indian', 'crypto', 'commodities', 'global']),
  mode: z.enum(['graceful', 'close_all']),
})

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const parsed = schema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

  const { marketType, mode } = parsed.data

  const lock = await acquireBotLock(session.id, 'stop')
  if (!lock.acquired) {
    if (lock.isRedisDown) {
      console.warn(`[bot/stop-market] Redis down for user=${session.id} — proceeding without lock`)
      try {
        return await _handleStopMarket(req, session.id, marketType, mode)
      } catch (e) {
        console.error('[bot/stop-market] Stop-market failed while Redis down:', e)
        return NextResponse.json({ error: 'Failed to stop market. Please try again.' }, { status: 500 })
      }
    }
    return NextResponse.json({ error: lock.reason }, { status: 429 })
  }

  try {
    return await _handleStopMarket(req, session.id, marketType, mode)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[bot/stop-market] failed for user=${session.id}:`, e)
    return NextResponse.json({ error: `Stop market failed: ${msg}` }, { status: 500 })
  } finally {
    await lock.release()
  }
}

async function _handleStopMarket(
  req: NextRequest,
  userId: string,
  marketType: string,
  mode: 'graceful' | 'close_all',
) {
  const current = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, userId),
    columns: { status: true, activeMarkets: true },
  })

  if (!current || current.status === 'stopped') {
    return NextResponse.json({ error: 'Bot is not running' }, { status: 409 })
  }

  const now = new Date()

  const activeSessionRows = await db.query.botSessions.findMany({
    where: and(
      eq(botSessions.userId, userId),
      sql`${botSessions.status} IN ('running', 'stopping')`,
    ),
    columns: { market: true },
  })

  const activeMarkets = Array.from(new Set([
    ...(((current.status === 'running' || current.status === 'stopping') ? current.activeMarkets : []) ?? []),
    ...activeSessionRows.map((session) => session.market),
  ]))

  if (!activeMarkets.includes(marketType)) {
    return NextResponse.json({ error: `${marketType} is not currently active` }, { status: 409 })
  }

  const [claimed] = await db.update(botStatuses)
    .set({ updatedAt: now })
    .where(and(
      eq(botStatuses.userId, userId),
      sql`${botStatuses.status} <> 'stopped'`,
    ))
    .returning({ id: botStatuses.id })

  if (!claimed) {
    return NextResponse.json({ error: `${marketType} is not currently active` }, { status: 409 })
  }

  const remainingMarkets = activeMarkets.filter((m) => m !== marketType)

  // Count open trades for this market
  const [openRows] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trades)
    .where(and(
      eq(trades.userId, userId),
      eq(trades.marketType, marketType as any),
      eq(trades.status, 'open' as any),
    ))
  const openCount = openRows?.count ?? 0

  const isLastMarket = remainingMarkets.length === 0

  // ── Determine new bot status ───────────────────────────────────────────
  // graceful + last market + open trades → stopping/graceful (drain)
  // graceful + last market + no trades  → stopped immediately
  // close_all + last market             → stopped immediately (positions unmonitored)
  // any mode + not last market          → keep running for remaining markets

  if (isLastMarket) {
    const shouldDrain = mode === 'graceful' && openCount > 0

    await db.update(botStatuses)
      .set({
        status:         shouldDrain ? 'stopping' as any : 'stopped' as any,
        activeMarkets:  [],
        stopMode:       shouldDrain ? 'graceful' : null,
        stoppingAt:     shouldDrain ? now : null,
        stoppedAt:      shouldDrain ? null : now,
        updatedAt:      now,
        stopTimeoutSec: shouldDrain ? 3600 : null,
      })
      .where(eq(botStatuses.userId, userId))
  } else {
    // Not last market — just remove this market from active set
    await db.update(botStatuses)
      .set({
        activeMarkets: remainingMarkets,
        updatedAt:     now,
      })
      .where(eq(botStatuses.userId, userId))
  }

  // ── Update session records for this market ─────────────────────────────
  const runningSessions = await db.query.botSessions.findMany({
    where: and(
      eq(botSessions.userId, userId),
      eq(botSessions.market, marketType),
      sql`${botSessions.status} IN ('running', 'stopping')`,
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
          eq(trades.userId, userId),
          eq(trades.marketType, marketType as any),
          s.startedAt ? sql`${trades.openedAt} >= ${s.startedAt}` : sql`true`,
          sql`${trades.openedAt} <= ${now}`,
        ))

      const row = stats[0]
      const sessionShouldDrain = mode === 'graceful' && (row?.open ?? 0) > 0 && isLastMarket

      await db.update(botSessions)
        .set({
          status:       sessionShouldDrain ? 'stopping' : 'stopped',
          endedAt:      sessionShouldDrain ? null : now,
          totalTrades:  row?.total  ?? 0,
          openTrades:   sessionShouldDrain ? (row?.open ?? 0) : 0,
          closedTrades: row?.closed ?? 0,
          totalPnl:     String(row?.pnl ?? 0),
        })
        .where(eq(botSessions.id, s.id))
    } catch (err) {
      console.error(`[stop-market] Session update failed for ${s.id}:`, err)
    }
  }

  // ── Notify engine ──────────────────────────────────────────────────────
  try {
    if (remainingMarkets.length > 0) {
      await postToBotEngine('/bot/sync', { user_id: userId, markets: remainingMarkets }, 8_000)
    } else if (mode === 'graceful' && openCount > 0) {
      // Tell engine to drain — no new trades, monitor existing
      await postToBotEngine('/bot/drain', { user_id: userId }, 8_000)
    } else {
      await postToBotEngine('/bot/stop', { user_id: userId }, 8_000)
    }
  } catch (err) {
    console.warn(`[stop-market] Engine notify failed (non-fatal):`, err)
  }

  const { snapshot } = await getBotStatusSnapshot(userId)

  return NextResponse.json({
    success: true,
    stoppedMarket: marketType,
    mode,
    remainingMarkets,
    openPositionsClosed: 0,
    // close_all stops monitoring immediately — positions need manual management
    warning: mode === 'close_all' && openCount > 0
      ? `${openCount} open position(s) in ${marketType} are no longer monitored. Close them manually on the exchange.`
      : undefined,
    ...snapshot,
  })
}
