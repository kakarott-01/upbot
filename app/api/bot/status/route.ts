// app/api/bot/status/route.ts
// ===========================
// REVISED: Auto-detects graceful drain completion so the bot transitions
// to "stopped" the moment all positions close — without relying on the
// Python→Next.js HTTP callback (which can fail on Render cold starts).
//
// Also exposes stopMode, openTradeCount, stoppingAt, timeoutWarning,
// AND perMarketOpenTrades (new) so per-market stop modals show correct counts.

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { _doImmediateStop } from '@/lib/bot-stop'
import { getBotStatusSnapshot } from '@/lib/bot/status-snapshot'
import { toUtcIsoString } from '@/lib/time'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { statusRow, snapshot } = await getBotStatusSnapshot(session.id)

  // ── Auto-detect graceful drain completion ─────────────────────────────────
  if (
    statusRow?.status === 'stopping' &&
    statusRow.stopMode === 'graceful' &&
    snapshot.openTradeCount === 0
  ) {
    const now = new Date()
    try {
      await _doImmediateStop(session.id, now)
    } catch (e) {
      console.error('[bot/status] Auto-stop after drain failed:', e)
    }

    const nowIso = toUtcIsoString(now)
    return NextResponse.json({
      ...snapshot,
      status: 'stopped',
      stopMode: null,
      activeMarkets: [],
      stopped_at: nowIso,
      stopping_at: null,
      errorMessage: null,
      openTradeCount: 0,
      perMarketOpenTrades: {},
      timeoutWarning: false,
      sessions: snapshot.sessions.map((item) =>
        item.status === 'running'
          ? { ...item, status: 'stopped', stopped_at: nowIso }
          : item,
      ),
    })
  }

  return NextResponse.json(snapshot)
}
