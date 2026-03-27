// app/api/mode/route.ts
//
// GET  /api/mode          → returns all market modes for the current user
// POST /api/mode          → switches a market's mode (paper ↔ live)
//
// Rules enforced here:
//  1. Bot must be STOPPED before any mode switch
//  2. paper → live requires a valid OTP (reuses the reveal-OTP cookie infrastructure)
//  3. Every switch is written to mode_audit_logs

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { marketConfigs, botStatuses, modeAuditLogs } from '@/lib/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getClientIp } from '@/lib/utils'

// ── Validation ─────────────────────────────────────────────────────────────────
const switchSchema = z.object({
  marketType: z.enum(['indian', 'crypto', 'commodities', 'global']),
  toMode:     z.enum(['paper', 'live']),
})

// ── GET: return current mode for every market ──────────────────────────────────
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
      paperMode:  true,  // legacy, returned for backward compat
      isActive:   true,
      updatedAt:  true,
    },
  })

  // Also return bot running status so the UI can disable toggles
  const botStatus = await db.query.botStatuses.findFirst({
    where: eq(botStatuses.userId, session.id),
    columns: { status: true },
  })

  return NextResponse.json({
    botRunning: botStatus?.status === 'running',
    markets:    configs,
  })
}

// ── POST: switch mode for a market ────────────────────────────────────────────
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

  // No-op: already in requested mode
  if (fromMode === toMode) {
    return NextResponse.json({ success: true, mode: toMode })
  }

  // ── Guard 2: paper → live requires OTP verification ──────────────────────
  if (toMode === 'live') {
    const revealToken = req.cookies.get('reveal_token')?.value
    if (!revealToken) {
      return NextResponse.json(
        { error: 'OTP verification required to enable live trading.', requiresOtp: true },
        { status: 403 }
      )
    }

    // Validate reveal token (same format used by /api/exchange/verify-reveal-otp)
    try {
      const [tokenUserId, timestamp] = Buffer.from(revealToken, 'base64')
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
        paperMode: toMode === 'paper',  // keep legacy column in sync
        updatedAt: new Date(),
      })
      .where(eq(marketConfigs.id, existing.id))
  } else {
    // Create config row if it doesn't exist yet
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