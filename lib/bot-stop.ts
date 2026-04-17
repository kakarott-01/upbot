// lib/bot-stop.ts — v4
// ================
// FIX: Added activeMarkets: [] to _doImmediateStop.
// ROOT CAUSE: Previously the update never cleared activeMarkets.
// buildSessions() in status-snapshot.ts checks activeMarkets.includes(market)
// to decide if a session shows as 'running'. With activeMarkets still containing
// ['crypto'] after stop, the UI showed Crypto as "Running" even though
// bot_statuses.status = 'stopped'. One-line fix, critical impact.

import { db } from '@/lib/db'
import { botStatuses, botSessions, trades } from '@/lib/schema'
import { eq, and, sql } from 'drizzle-orm'
import { postToBotEngine } from '@/lib/bot-engine-client'

export async function _doImmediateStop(userId: string, now: Date) {
  // ── Atomic claim — only one concurrent call succeeds ──────────────────
  const claimed = await db
    .update(botStatuses)
    .set({
      status:       'stopped',
      stoppedAt:    now,
      updatedAt:    now,
      stopMode:     null,
      stoppingAt:   null,
      activeMarkets: [],   // FIX: must clear so buildSessions() stops showing markets as running
    })
    .where(
      and(
        eq(botStatuses.userId, userId),
        sql`${botStatuses.status} IN ('stopping', 'running')`,
      )
    )
    .returning({ id: botStatuses.id })

  if (claimed.length === 0) {
    // Another instance already completed the stop, or bot was already stopped.
    return
  }

  // ── Notify engine (best-effort) ────────────────────────────────────────
  postToBotEngine('/bot/stop', { user_id: userId }, 8_000).catch(() => null)

  // ── Find all sessions that are still running ───────────────────────────
  let runningSessions: Awaited<ReturnType<typeof db.query.botSessions.findMany>>
  try {
    runningSessions = await db.query.botSessions.findMany({
      where: and(
        eq(botSessions.userId, userId),
        sql`${botSessions.status} IN ('running', 'stopping')`,
      ),
    })
  } catch (e) {
    console.error(`[bot-stop] Failed to query running sessions for user=${userId}:`, e)
    return
  }

  // ── Update each session with final trade stats ─────────────────────────
  for (const s of runningSessions) {
    try {
      const stats = await db
        .select({
          total:  sql<number>`count(*)::int`,
          open:   sql<number>`count(*) filter (where status='open')::int`,
          closed: sql<number>`count(*) filter (where status='closed')::int`,
          pnl:    sql<number>`coalesce(sum(pnl) filter (where status='closed'),0)::float`,
        })
        .from(trades)
        .where(and(
          eq(trades.userId, userId),
          eq(trades.marketType, s.market as any),
          s.startedAt
            ? sql`${trades.openedAt} >= ${s.startedAt}`
            : sql`true`,
          // Upper bound: only count trades opened before this session ended
          sql`${trades.openedAt} <= ${now}`,
        ))

      const row = stats[0]
      await db.update(botSessions)
        .set({
          status:       'stopped',
          endedAt:      now,
          totalTrades:  row?.total  ?? 0,
          openTrades:   row?.open   ?? 0,
          closedTrades: row?.closed ?? 0,
          totalPnl:     String(row?.pnl ?? 0),
        })
        .where(eq(botSessions.id, s.id))
    } catch (sessionErr) {
      console.error(
        `[bot-stop] Failed to update session ${s.id} for user=${userId}:`,
        sessionErr
      )
    }
  }
}