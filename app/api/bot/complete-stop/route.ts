// app/api/bot/complete-stop/route.ts
// ====================================
// Called INTERNALLY by the bot engine (Python) when it has finished
// draining or closing all positions and is ready to fully stop.
//
// Bug fixed: previously called _doImmediateStop with no lock, while
// /api/bot/stop holds a Redis lock during its operation. This created
// a race condition where both routes could write to bot_statuses
// simultaneously. Now acquires the same Redis lock before proceeding.
// If a stop is already in progress, returns 200 (idempotent — the
// other stop operation will finish the job).
//
// This is NOT a user-facing endpoint. Protected by X-Bot-Secret.

import { NextRequest, NextResponse } from 'next/server'
import { _doImmediateStop } from '@/lib/bot-stop'
import { acquireBotLock } from '@/lib/bot-lock'

export const maxDuration = 10

export async function POST(req: NextRequest) {
  // Verify the request is from the bot engine, not a user
  const secret = req.headers.get('x-bot-secret')
  if (!secret || secret !== process.env.BOT_ENGINE_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let userId: string
  try {
    const body = await req.json()
    userId = body?.user_id
    if (!userId) throw new Error('missing user_id')
  } catch {
    return NextResponse.json({ error: 'user_id required' }, { status: 400 })
  }

  // Acquire the same lock used by /api/bot/stop to prevent race conditions
  // where both routes write to bot_statuses simultaneously.
  const lock = await acquireBotLock(userId, 'stop')
  if (!lock.acquired) {
    // Another stop operation is already in progress — that's fine.
    // The other operation will complete the stop. Return 200 so the
    // bot engine doesn't retry unnecessarily.
    console.info(`[complete-stop] Lock held for user=${userId} — another stop in progress, skipping`)
    return NextResponse.json({ success: true, status: 'stopping' })
  }

  try {
    await _doImmediateStop(userId, new Date())
    return NextResponse.json({ success: true, status: 'stopped' })
  } finally {
    await lock.release()
  }
}
