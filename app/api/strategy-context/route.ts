import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { riskSettings } from '@/lib/schema'
import { PUBLIC_STRATEGY_CATALOG, ensureStrategyCatalogSeeded } from '@/lib/strategies/catalog'
import { getUserMarketStrategyConfig } from '@/lib/strategies/config-service'
import { guardErrorResponse, requireAccess } from '@/lib/guards'

const MARKETS = ['indian', 'crypto', 'commodities', 'global'] as const

export async function GET() {
  let session
  try {
    session = await requireAccess()
  } catch (error) {
    return guardErrorResponse(error)
  }

  await ensureStrategyCatalogSeeded()

  const [markets, riskConfig] = await Promise.all([
    Promise.all(
      MARKETS.map(async (market) => ({
        marketType: market,
        ...(await getUserMarketStrategyConfig(session.id, market)),
      })),
    ),
    db.query.riskSettings.findFirst({
      where: eq(riskSettings.userId, session.id),
    }),
  ])

  return NextResponse.json({
    strategies: PUBLIC_STRATEGY_CATALOG,
    markets,
    riskSettings: riskConfig ?? {},
  })
}
