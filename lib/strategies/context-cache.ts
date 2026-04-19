import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { redis } from '@/lib/redis'
import { riskSettings } from '@/lib/schema'
import { PUBLIC_STRATEGY_CATALOG, ensureStrategyCatalogSeeded } from '@/lib/strategies/catalog'
import { getUserMarketStrategyConfig } from '@/lib/strategies/config-service'

export const STRATEGY_CONTEXT_CACHE_TTL_SECONDS = 30
export const STRATEGY_CONTEXT_MARKETS = ['indian', 'crypto', 'commodities', 'global'] as const

export function getStrategyContextCacheKey(userId: string) {
  return `strategy_context:${userId}`
}

export async function readStrategyContextCache(userId: string) {
  const cached = await redis.get<string>(getStrategyContextCacheKey(userId)).catch(() => null)
  if (!cached) {
    return null
  }

  try {
    const parsed = JSON.parse(cached)
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.markets)) {
      return null
    }

    return parsed as {
      strategies: typeof PUBLIC_STRATEGY_CATALOG
      markets: Array<Awaited<ReturnType<typeof getUserMarketStrategyConfig>> & { marketType: typeof STRATEGY_CONTEXT_MARKETS[number] }>
      riskSettings: Record<string, unknown>
    }
  } catch {
    return null
  }
}

export async function writeStrategyContextCache(userId: string, data: unknown) {
  await redis
    .set(getStrategyContextCacheKey(userId), JSON.stringify(data), { ex: STRATEGY_CONTEXT_CACHE_TTL_SECONDS })
    .catch(() => null)
}

export async function invalidateStrategyContextCache(userId: string) {
  await redis.del(getStrategyContextCacheKey(userId)).catch(() => null)
}

export async function buildStrategyContextResponse(userId: string) {
  await ensureStrategyCatalogSeeded()

  const [markets, riskConfig] = await Promise.all([
    Promise.all(
      STRATEGY_CONTEXT_MARKETS.map(async (market) => ({
        marketType: market,
        ...(await getUserMarketStrategyConfig(userId, market)),
      })),
    ),
    db.query.riskSettings.findFirst({
      where: eq(riskSettings.userId, userId),
    }),
  ])

  return {
    strategies: PUBLIC_STRATEGY_CATALOG,
    markets,
    riskSettings: riskConfig ?? {},
  }
}
