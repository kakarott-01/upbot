import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { exchangeApis, marketStrategyConfigs, marketStrategySelections, strategies } from '@/lib/schema'
import { ensureStrategyCatalogSeeded } from './catalog'
import { validateStrategiesForMarket } from './validation'
import { analyzeStrategyConflicts, hasBlockingConflict } from './conflicts'
import { resolveExchangeCapabilities } from './exchange-capabilities'
import type { MarketType, StrategyRuntimeConfig } from './types'

const DEFAULT_STRATEGY_SETTINGS = {
  priority: 'MEDIUM' as const,
  cooldownAfterTradeSec: 0,
  capitalAllocation: {
    perTradePercent: 10,
    maxActivePercent: 25,
  },
  health: {
    minWinRatePct: 30,
    maxDrawdownPct: 15,
    maxLossStreak: 5,
    isAutoDisabled: false,
    autoDisabledReason: null as string | null,
    lastTradeAt: null as string | null,
  },
}

export async function getUserMarketStrategyConfig(
  userId: string,
  marketType: MarketType,
): Promise<StrategyRuntimeConfig> {
  await ensureStrategyCatalogSeeded()

  const [config, exchangeApi] = await Promise.all([
    db.query.marketStrategyConfigs.findFirst({
      where: and(
        eq(marketStrategyConfigs.userId, userId),
        eq(marketStrategyConfigs.marketType, marketType),
      ),
      with: {
        selections: {
          with: {
            strategy: true,
          },
        },
      },
    }),
    db.query.exchangeApis.findFirst({
      where: and(
        eq(exchangeApis.userId, userId),
        eq(exchangeApis.marketType, marketType),
        eq(exchangeApis.isActive, true),
      ),
      columns: {
        exchangeName: true,
      },
    }),
  ])

  const strategyKeys = (config?.selections ?? [])
    .sort((a, b) => (a.slot > b.slot ? 1 : -1))
    .map((selection) => selection.strategy.strategyKey)
  const strategySettings = Object.fromEntries(
    (config?.selections ?? []).map((selection) => [
      selection.strategy.strategyKey,
      {
        priority: selection.priority ?? DEFAULT_STRATEGY_SETTINGS.priority,
        cooldownAfterTradeSec: selection.cooldownAfterTradeSec ?? DEFAULT_STRATEGY_SETTINGS.cooldownAfterTradeSec,
        capitalAllocation: {
          perTradePercent: Number(selection.perTradePercent ?? DEFAULT_STRATEGY_SETTINGS.capitalAllocation.perTradePercent),
          maxActivePercent: Number(selection.maxActivePercent ?? DEFAULT_STRATEGY_SETTINGS.capitalAllocation.maxActivePercent),
        },
        health: {
          minWinRatePct: Number(selection.healthMinWinRatePct ?? DEFAULT_STRATEGY_SETTINGS.health.minWinRatePct),
          maxDrawdownPct: Number(selection.healthMaxDrawdownPct ?? DEFAULT_STRATEGY_SETTINGS.health.maxDrawdownPct),
          maxLossStreak: selection.healthMaxLossStreak ?? DEFAULT_STRATEGY_SETTINGS.health.maxLossStreak,
          isAutoDisabled: selection.isAutoDisabled ?? false,
          autoDisabledReason: selection.autoDisabledReason ?? null,
          lastTradeAt: selection.lastTradeAt?.toISOString() ?? null,
        },
      },
    ]),
  )
  const conflictWarnings = config?.conflictWarnings ?? analyzeStrategyConflicts(strategyKeys)
  const exchangeCapabilities = resolveExchangeCapabilities(
    exchangeApi?.exchangeName,
    config?.positionMode ?? 'NET',
  )

  return {
    executionMode: config?.executionMode ?? 'SAFE',
    positionMode: exchangeCapabilities.effectivePositionMode,
    allowHedgeOpposition: config?.allowHedgeOpposition ?? false,
    conflictBlocking: config?.conflictBlocking ?? false,
    maxPositionsPerSymbol: config?.maxPositionsPerSymbol ?? 2,
    maxCapitalPerStrategyPct: Number(config?.maxCapitalPerStrategyPct ?? '25'),
    maxDrawdownPct: Number(config?.maxDrawdownPct ?? '12'),
    strategyKeys,
    strategySettings,
    conflictWarnings: [
      ...conflictWarnings,
      ...(exchangeCapabilities.warning
        ? [{ code: 'EXCHANGE_HEDGE_FALLBACK', severity: 'warning' as const, message: exchangeCapabilities.warning }]
        : []),
    ],
    exchangeCapabilities,
  }
}

export async function upsertUserMarketStrategyConfig(params: {
  userId: string
  marketType: MarketType
  executionMode: 'SAFE' | 'AGGRESSIVE'
  positionMode: 'NET' | 'HEDGE'
  allowHedgeOpposition: boolean
  conflictBlocking: boolean
  aggressiveConfirmed: boolean
  maxPositionsPerSymbol: number
  maxCapitalPerStrategyPct: number
  maxDrawdownPct: number
  strategyKeys: string[]
  strategySettings: StrategyRuntimeConfig['strategySettings']
}) {
  await ensureStrategyCatalogSeeded()
  validateStrategiesForMarket(params.marketType, params.strategyKeys)

  const conflicts = analyzeStrategyConflicts(params.strategyKeys)
  if (params.conflictBlocking && conflicts.length > 0) {
    throw new Error('Strategy conflict blocking is enabled. Resolve conflicts or disable blocking before saving.')
  }
  if (hasBlockingConflict(conflicts)) {
    throw new Error('Selected strategy combination is blocked by conflict policy.')
  }
  if (params.executionMode === 'AGGRESSIVE' && !params.aggressiveConfirmed) {
    throw new Error('AGGRESSIVE mode requires explicit confirmation.')
  }
  if (params.positionMode === 'HEDGE' && params.executionMode !== 'AGGRESSIVE') {
    throw new Error('HEDGE mode is only available with AGGRESSIVE execution.')
  }
  for (const key of params.strategyKeys) {
    const settings = params.strategySettings[key] ?? DEFAULT_STRATEGY_SETTINGS
    if (settings.capitalAllocation.perTradePercent > settings.capitalAllocation.maxActivePercent) {
      throw new Error(`${key} per-trade allocation cannot exceed max active allocation.`)
    }
  }

  const strategyRows = await db.query.strategies.findMany({
    where: inArray(strategies.strategyKey, params.strategyKeys),
    columns: { id: true, strategyKey: true },
  })

  if (strategyRows.length !== params.strategyKeys.length) {
    throw new Error('One or more strategies are unavailable.')
  }

  const exchangeApi = await db.query.exchangeApis.findFirst({
    where: and(
      eq(exchangeApis.userId, params.userId),
      eq(exchangeApis.marketType, params.marketType),
      eq(exchangeApis.isActive, true),
    ),
    columns: { exchangeName: true },
  })

  const exchangeCapabilities = resolveExchangeCapabilities(
    exchangeApi?.exchangeName,
    params.positionMode,
  )

  const existing = await db.query.marketStrategyConfigs.findFirst({
    where: and(
      eq(marketStrategyConfigs.userId, params.userId),
      eq(marketStrategyConfigs.marketType, params.marketType),
    ),
    columns: { id: true },
  })

  const now = new Date()
  const configId = existing?.id ?? (
    await db.insert(marketStrategyConfigs).values({
      userId: params.userId,
      marketType: params.marketType,
      executionMode: params.executionMode,
      positionMode: exchangeCapabilities.effectivePositionMode,
      allowHedgeOpposition: params.allowHedgeOpposition && exchangeCapabilities.effectivePositionMode === 'HEDGE',
      conflictBlocking: params.conflictBlocking,
      aggressiveConfirmedAt: params.executionMode === 'AGGRESSIVE' ? now : null,
      maxPositionsPerSymbol: params.maxPositionsPerSymbol,
      maxCapitalPerStrategyPct: params.maxCapitalPerStrategyPct.toFixed(2),
      maxDrawdownPct: params.maxDrawdownPct.toFixed(2),
      conflictWarnings: conflicts,
      exchangeCapabilities,
      updatedAt: now,
    }).returning({ id: marketStrategyConfigs.id })
  )[0].id

  if (existing) {
    await db.update(marketStrategyConfigs)
      .set({
        executionMode: params.executionMode,
        positionMode: exchangeCapabilities.effectivePositionMode,
        allowHedgeOpposition: params.allowHedgeOpposition && exchangeCapabilities.effectivePositionMode === 'HEDGE',
        conflictBlocking: params.conflictBlocking,
        aggressiveConfirmedAt: params.executionMode === 'AGGRESSIVE' ? now : null,
        maxPositionsPerSymbol: params.maxPositionsPerSymbol,
        maxCapitalPerStrategyPct: params.maxCapitalPerStrategyPct.toFixed(2),
        maxDrawdownPct: params.maxDrawdownPct.toFixed(2),
        conflictWarnings: conflicts,
        exchangeCapabilities,
        updatedAt: now,
      })
      .where(eq(marketStrategyConfigs.id, existing.id))
  }

  await db.delete(marketStrategySelections).where(eq(marketStrategySelections.configId, configId))

  if (strategyRows.length > 0) {
    const byKey = new Map(strategyRows.map((row) => [row.strategyKey, row.id]))
    await db.insert(marketStrategySelections).values(
      params.strategyKeys.map((key, index) => ({
        ...(params.strategySettings[key] ? {
          priority: params.strategySettings[key].priority,
          cooldownAfterTradeSec: params.strategySettings[key].cooldownAfterTradeSec,
          perTradePercent: params.strategySettings[key].capitalAllocation.perTradePercent.toFixed(2),
          maxActivePercent: params.strategySettings[key].capitalAllocation.maxActivePercent.toFixed(2),
          healthMinWinRatePct: params.strategySettings[key].health.minWinRatePct.toFixed(2),
          healthMaxDrawdownPct: params.strategySettings[key].health.maxDrawdownPct.toFixed(2),
          healthMaxLossStreak: params.strategySettings[key].health.maxLossStreak,
          isAutoDisabled: params.strategySettings[key].health.isAutoDisabled,
          autoDisabledReason: params.strategySettings[key].health.autoDisabledReason ?? null,
          lastTradeAt: params.strategySettings[key].health.lastTradeAt ? new Date(params.strategySettings[key].health.lastTradeAt) : null,
        } : {
          priority: DEFAULT_STRATEGY_SETTINGS.priority,
          cooldownAfterTradeSec: DEFAULT_STRATEGY_SETTINGS.cooldownAfterTradeSec,
          perTradePercent: DEFAULT_STRATEGY_SETTINGS.capitalAllocation.perTradePercent.toFixed(2),
          maxActivePercent: DEFAULT_STRATEGY_SETTINGS.capitalAllocation.maxActivePercent.toFixed(2),
          healthMinWinRatePct: DEFAULT_STRATEGY_SETTINGS.health.minWinRatePct.toFixed(2),
          healthMaxDrawdownPct: DEFAULT_STRATEGY_SETTINGS.health.maxDrawdownPct.toFixed(2),
          healthMaxLossStreak: DEFAULT_STRATEGY_SETTINGS.health.maxLossStreak,
          isAutoDisabled: false,
          autoDisabledReason: null,
          lastTradeAt: null,
        }),
        configId,
        strategyId: byKey.get(key)!,
        slot: (index === 0 ? 'PRIMARY' : 'SECONDARY') as 'PRIMARY' | 'SECONDARY',
      })),
    )
  }

  return getUserMarketStrategyConfig(params.userId, params.marketType)
}
