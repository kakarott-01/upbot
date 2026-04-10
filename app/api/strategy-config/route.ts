import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { assertBotStoppedForSensitiveMutation } from '@/lib/strategies/locks'
import { getUserMarketStrategyConfig, upsertUserMarketStrategyConfig } from '@/lib/strategies/config-service'
import { strategyConfigSchema } from '@/lib/strategies/validation'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

export async function GET(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  const marketType = req.nextUrl.searchParams.get('marketType')
  if (!marketType) {
    const markets = ['indian', 'crypto', 'commodities', 'global'] as const
    const configs = await Promise.all(
      markets.map(async (market) => ({
        marketType: market,
        ...(await getUserMarketStrategyConfig(session.id, market)),
      })),
    )
    return NextResponse.json({ markets: configs })
  }

  if (!['indian', 'crypto', 'commodities', 'global'].includes(marketType)) {
    return NextResponse.json({ error: 'Valid marketType is required.' }, { status: 400 })
  }

  const config = await getUserMarketStrategyConfig(session.id, marketType as any)
  return NextResponse.json(config)
}

export async function PUT(req: NextRequest) {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  try {
    const parsed = strategyConfigSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    // ── Per-market lock: only block if THIS specific market is running ──────
    // Users can still edit strategies for idle markets while others run.
    await assertBotStoppedForSensitiveMutation(
      session.id,
      `Stop the bot for ${parsed.data.marketType} before changing its strategies.`,
      parsed.data.marketType,
    )

    const config = await upsertUserMarketStrategyConfig({
      userId: session.id,
      marketType: parsed.data.marketType,
      executionMode: parsed.data.executionMode,
      positionMode: parsed.data.positionMode,
      allowHedgeOpposition: parsed.data.allowHedgeOpposition,
      conflictBlocking: parsed.data.conflictBlocking,
      aggressiveConfirmed: parsed.data.aggressiveConfirmed,
      maxPositionsPerSymbol: parsed.data.maxPositionsPerSymbol,
      maxCapitalPerStrategyPct: parsed.data.maxCapitalPerStrategyPct,
      maxDrawdownPct: parsed.data.maxDrawdownPct,
      strategyKeys: parsed.data.strategyKeys,
      strategySettings: parsed.data.strategySettings,
    })

    return NextResponse.json({ success: true, config })
  } catch (error) {
    const status = (error as Error & { status?: number }).status ?? 400
    return NextResponse.json({ error: (error as Error).message }, { status })
  }
}
