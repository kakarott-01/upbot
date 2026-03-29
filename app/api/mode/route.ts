// app/api/mode/route.ts
//
// GET  /api/mode  → returns all market modes for the current user
// POST /api/mode  → switches a market's mode (paper ↔ live)
//
// Rules enforced:
//  1. Bot must be STOPPED before any mode switch
//  2. paper → live requires a valid mode_switch_token cookie
//     (set by /api/mode/verify-otp, NOT the reveal-API-keys OTP)
//  3. Every switch is written to mode_audit_logs

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { marketConfigs, botStatuses, modeAuditLogs } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getClientIp } from '@/lib/utils'

const switchSchema = z.object({
  marketType: z.enum(['indian', 'crypto', 'commodities', 'global']),
  toMode:     z.enum(['paper', 'live']),
})

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const configs = await db.query.marketConfigs.findMany({
    where: eq(marketConfigs.userId, session.id),
    columns: {
      marketType: true,
      mode:       true,
      paperMode:  true,
      isActive:   true,
      updatedAt:  true,
    },
  })

  const botStatus = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, session.id),
    columns: { status: true, activeMarkets: true },
  })

  return NextResponse.json({
    botRunning:    botStatus?.status === 'running',
    activeMarkets: botStatus?.activeMarkets ?? [],
    markets:       configs,
  })
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body   = await req.json()
  const parsed = switchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { marketType, toMode } = parsed.data

  // ── Guard 1: bot must be stopped ─────────────────────────────────────────
  const botStatus = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, session.id),
    columns: { status: true },
  })

  if (botStatus?.status === 'running') {
    return NextResponse.json(
      { error: 'Stop the bot before changing trading mode.' },
      { status: 409 }
    )
  }

  // ── Load current config ───────────────────────────────────────────────────
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

  // ── Guard 2: paper → live requires mode_switch_token cookie ──────────────
  // This is a SEPARATE token from the reveal_token used for viewing API keys.
  if (toMode === 'live') {
    const modeSwitchToken = req.cookies.get('mode_switch_token')?.value
    if (!modeSwitchToken) {
      return NextResponse.json(
        { error: 'OTP verification required to enable live trading.', requiresOtp: true },
        { status: 403 }
      )
    }

    try {
      const [tokenUserId, timestamp] = Buffer.from(modeSwitchToken, 'base64')
        .toString('utf8')
        .split(':')

      if (tokenUserId !== session.id) {
        return NextResponse.json({ error: 'Invalid OTP token.', requiresOtp: true }, { status: 403 })
      }

      const tokenAge = Date.now() - Number(timestamp)
      if (tokenAge > 5 * 60 * 1000) {
        return NextResponse.json(
          { error: 'OTP token expired. Please verify again.', requiresOtp: true },
          { status: 403 }
        )
      }
    } catch {
      return NextResponse.json({ error: 'Invalid OTP token.', requiresOtp: true }, { status: 403 })
    }
  }

  // ── Apply the mode switch ─────────────────────────────────────────────────
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

  // ── Write audit log ───────────────────────────────────────────────────────
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