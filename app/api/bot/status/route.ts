// app/api/bot/status/route.ts
// ===========================
// REVISED: Auto-detects graceful drain completion so the bot transitions
// to "stopped" the moment all positions close — without relying on the
// Python→Next.js HTTP callback (which can fail on Render cold starts).
//
// Also exposes stopMode, openTradeCount, stoppingAt, timeoutWarning,
// AND perMarketOpenTrades (new) so per-market stop modals show correct counts.

import { NextRequest, NextResponse } from 'next/server'
import { _doImmediateStop } from '@/lib/bot-stop'
import { getBotStatusSnapshot, type BotStatusSnapshotData } from '@/lib/bot/status-snapshot'
import { readCachedBotStatusSnapshot, writeCachedBotStatusSnapshot } from '@/lib/bot/status-cache'
import { toUtcIsoString } from '@/lib/time'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export const maxDuration = 10

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const cachedSnapshot = await readCachedBotStatusSnapshot(session.id)
  if (cachedSnapshot) {
    return NextResponse.json(cachedSnapshot, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': 'HIT',
      },
    })
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
    const stoppedSnapshot: BotStatusSnapshotData = {
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
    }

    await writeCachedBotStatusSnapshot(session.id, stoppedSnapshot)

    return NextResponse.json(stoppedSnapshot, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Cache': 'MISS',
      },
    })
  }

  await writeCachedBotStatusSnapshot(session.id, snapshot)

  return NextResponse.json(snapshot, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Cache': 'MISS',
    },
  })
}
