import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { killSwitchState } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET() {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const state = await db.query.killSwitchState.findFirst({
    where: eq(killSwitchState.userId, session.id),
  })

  return NextResponse.json(state ?? {
    isActive: false,
    closePositions: false,
    reason: null,
    activatedAt: null,
    lastDeactivatedAt: null,
  })
}

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const body = await req.json().catch(() => ({}))
  const isActive = Boolean(body?.isActive)
  const closePositions = Boolean(body?.closePositions)
  const reason = typeof body?.reason === 'string' ? body.reason : null
  const now = new Date()

  await db.insert(killSwitchState).values({
    userId: session.id,
    isActive,
    closePositions,
    reason,
    activatedAt: isActive ? now : null,
    lastDeactivatedAt: isActive ? null : now,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: killSwitchState.userId,
    set: {
      isActive,
      closePositions,
      reason,
      activatedAt: isActive ? now : undefined,
      lastDeactivatedAt: isActive ? undefined : now,
      updatedAt: now,
    },
  })

  if (isActive) {
    await fetch(`${process.env.BOT_ENGINE_URL}${closePositions ? '/bot/close-all' : '/bot/stop'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bot-Secret': process.env.BOT_ENGINE_SECRET!,
      },
      body: JSON.stringify({ user_id: session.id }),
      signal: AbortSignal.timeout(8_000),
    }).catch(() => null)
  }

  return NextResponse.json({ success: true, isActive, closePositions, reason })
}
