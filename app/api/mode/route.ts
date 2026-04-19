// ═══════════════════════════════════════════════════════════════════════════════
// app/api/mode/route.ts  — FIXED (POST handler)
// ═══════════════════════════════════════════════════════════════════════════════
// FIX: mode_switch_token now verified via verifySecureToken() (HMAC-SHA256).
//      The GET handler is unchanged.
// ═══════════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse }           from 'next/server'
import { db }                                   from '@/lib/db'
import { marketConfigs, modeAuditLogs } from '@/lib/schema'
import { eq, and }                              from 'drizzle-orm'
import { z }                                    from 'zod'
import { getClientIp }                          from '@/lib/utils'
import { verifySecureToken }                    from '@/lib/secure-token'  // FIX
import { assertBotStoppedForSensitiveMutation } from '@/lib/strategies/locks'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { getBotStatusSnapshot } from '@/lib/bot/status-snapshot'
import { readCachedBotStatusSnapshot, writeCachedBotStatusSnapshot } from '@/lib/bot/status-cache'

export const maxDuration = 10

const switchSchema = z.object({
  marketType: z.enum(['indian', 'crypto', 'commodities', 'global']),
  toMode:     z.enum(['paper', 'live']),
})

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const [configs, cachedSnapshot] = await Promise.all([
    db.query.marketConfigs.findMany({
      where: eq(marketConfigs.userId, session.id),
      columns: {
        marketType: true,
        mode:       true,
        paperMode:  true,
        isActive:   true,
        updatedAt:  true,
      },
    }),
    readCachedBotStatusSnapshot(session.id),
  ])

  const snapshot = cachedSnapshot ?? (await getBotStatusSnapshot(session.id)).snapshot
  if (!cachedSnapshot) {
    await writeCachedBotStatusSnapshot(session.id, snapshot)
  }

  return NextResponse.json({
    botRunning:    snapshot.status === 'running' || snapshot.status === 'stopping',
    activeMarkets: snapshot.activeMarkets,
    markets:       configs,
  })
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const body   = await req.json().catch(() => ({}))
  const parsed = switchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { marketType, toMode } = parsed.data

  try {
    await assertBotStoppedForSensitiveMutation(
      session.id,
      `Stop the bot for ${marketType} before changing trading mode.`,
      marketType,
    )
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: (error as Error & { status?: number }).status ?? 409 })
  }

  // Load current config
  const existing = await db.query.marketConfigs.findFirst({
    where: and(
      eq(marketConfigs.userId,     session.id),
      eq(marketConfigs.marketType, marketType as any),
    ),
  })

  const fromMode = existing?.mode ?? 'paper'

  if (fromMode === toMode) {
    return NextResponse.json({ success: true, mode: toMode })
  }

  // Guard 2: paper → live requires a valid HMAC-signed mode_switch_token cookie
  // FIX: was base64(userId:timestamp) — trivially forgeable
  if (toMode === 'live') {
    const rawToken = req.cookies.get('mode_switch_token')?.value
    if (!rawToken) {
      return NextResponse.json(
        { error: 'OTP verification required to enable live trading.', requiresOtp: true },
        { status: 403 }
      )
    }

    const result = verifySecureToken(rawToken, 'mode_switch')
    if (!result.ok) {
      return NextResponse.json(
        { error: `OTP token invalid: ${result.reason}`, requiresOtp: true },
        { status: 403 }
      )
    }
    if (result.userId !== session.id) {
      return NextResponse.json(
        { error: 'OTP token user mismatch.', requiresOtp: true },
        { status: 403 }
      )
    }
  }

  // Apply the mode switch
  if (existing) {
    await db.update(marketConfigs)
      .set({
        mode:      toMode,
        paperMode: toMode === 'paper',
        updatedAt: new Date(),
      })
      .where(eq(marketConfigs.id, existing.id))
  } else {
    await db.insert(marketConfigs).values({
      userId:     session.id,
      marketType: marketType as any,
      mode:       toMode,
      paperMode:  toMode === 'paper',
    })
  }

  // Write audit log
  await db.insert(modeAuditLogs).values({
    userId:    session.id,
    scope:     `exchange:${marketType}`,
    fromMode:  fromMode as any,
    toMode:    toMode as any,
    ipAddress: getClientIp(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  })

  console.info(
    `[MODE] user=${session.id} market=${marketType} ${fromMode} → ${toMode} ip=${getClientIp(req)}`
  )

  return NextResponse.json({ success: true, mode: toMode })
}
