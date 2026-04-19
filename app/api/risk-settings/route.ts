import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { invalidateStrategyContextCache } from '@/lib/strategies/context-cache'
import { riskSettings } from '@/lib/schema'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { guardErrorResponse, requireAccess } from '@/lib/guards'
import { assertBotStoppedForSensitiveMutation } from '@/lib/strategies/locks'

const schema = z.object({
  maxPositionPct: z.number().min(0.1).max(100),
  stopLossPct: z.number().min(0.1).max(100),
  takeProfitPct: z.number().min(0.1).max(100),
  maxDailyLossPct: z.number().min(0.1).max(100),
  maxOpenTrades: z.number().int().min(1).max(20),
  maxTotalExposure: z.number().min(0).max(1_000_000_000).default(0),
  maxDailyLoss: z.number().min(0).max(1_000_000_000).default(0),
  maxOpenPositions: z.number().int().min(0).max(1000).default(0),
  cooldownSeconds: z.number().int().min(0).max(86400),
  trailingStop: z.boolean(),
  paperBalance: z.number().min(100).max(10_000_000).optional().default(10000),
})

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const settings = await db.query.riskSettings.findFirst({
    where: eq(riskSettings.userId, session.id),
  })

  const res = NextResponse.json(settings ?? {})
  // Risk settings rarely change — cache 5 minutes, revalidate in background
  res.headers.set('Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  return res
}

export async function POST(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const body = await req.json().catch(() => ({}))
  const parsed = schema.safeParse(body)

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  try {
    await assertBotStoppedForSensitiveMutation(session.id, 'Stop the bot before changing risk settings.')
  } catch (error) {
    return guardErrorResponse(error)
  }

  const d = parsed.data

  await db.insert(riskSettings)
    .values({
      userId: session.id,
      maxPositionPct: String(d.maxPositionPct),
      stopLossPct: String(d.stopLossPct),
      takeProfitPct: String(d.takeProfitPct),
      maxDailyLossPct: String(d.maxDailyLossPct),
      maxOpenTrades: d.maxOpenTrades,
      maxTotalExposure: String(d.maxTotalExposure),
      maxDailyLoss: String(d.maxDailyLoss),
      maxOpenPositions: d.maxOpenPositions,
      cooldownSeconds: d.cooldownSeconds,
      trailingStop: d.trailingStop,
      paperBalance: String(d.paperBalance ?? 10000),
    })
    .onConflictDoUpdate({
      target: riskSettings.userId,
      set: {
        maxPositionPct: String(d.maxPositionPct),
        stopLossPct: String(d.stopLossPct),
        takeProfitPct: String(d.takeProfitPct),
        maxDailyLossPct: String(d.maxDailyLossPct),
        maxOpenTrades: d.maxOpenTrades,
        maxTotalExposure: String(d.maxTotalExposure),
        maxDailyLoss: String(d.maxDailyLoss),
        maxOpenPositions: d.maxOpenPositions,
        cooldownSeconds: d.cooldownSeconds,
        trailingStop: d.trailingStop,
        paperBalance: String(d.paperBalance ?? 10000),
        updatedAt: new Date(),
      },
    })

  await invalidateStrategyContextCache(session.id)
  return NextResponse.json({ success: true })
}
