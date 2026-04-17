export function defaultStrategySettings() {
  return {
    priority: 'MEDIUM',
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
      autoDisabledReason: null,
      lastTradeAt: null,
    },
  }
}

export function toStrategyPayload(strategySettings: any) {
  return Object.fromEntries(
    Object.entries(strategySettings).map(([key, settings]: any) => [
      key,
      {
        priority: settings.priority,
        cooldownAfterTradeSec: settings.cooldownAfterTradeSec,
        capitalAllocation: settings.capitalAllocation,
      },
    ]),
  )
}

export type RuntimeConfig = ReturnType<typeof createDefaultConfig>

export function createDefaultConfig() {
  return {
    executionMode: 'SAFE' as 'SAFE' | 'AGGRESSIVE',
    positionMode: 'NET' as 'NET' | 'HEDGE',
    allowHedgeOpposition: false,
    conflictBlocking: false,
    maxPositionsPerSymbol: 2,
    maxCapitalPerStrategyPct: 25,
    maxDrawdownPct: 12,
    strategyKeys: [] as string[],
    strategySettings: {} as Record<string, ReturnType<typeof defaultStrategySettings>>,
    conflictWarnings: [] as Array<{ code: string; severity: 'info' | 'warning' | 'blocking'; message: string }>,
    exchangeCapabilities: null as null | {
      supportsHedgeMode?: boolean
      effectivePositionMode?: 'NET' | 'HEDGE'
      warning?: string
    },
  }
}

export function configFromMarket(market: any): RuntimeConfig {
  return {
    ...createDefaultConfig(),
    executionMode: market.executionMode,
    positionMode: market.positionMode ?? 'NET',
    allowHedgeOpposition: market.allowHedgeOpposition ?? false,
    conflictBlocking: market.conflictBlocking ?? false,
    maxPositionsPerSymbol: market.maxPositionsPerSymbol ?? 2,
    maxCapitalPerStrategyPct: market.maxCapitalPerStrategyPct ?? 25,
    maxDrawdownPct: market.maxDrawdownPct ?? 12,
    strategyKeys: market.strategyKeys ?? [],
    strategySettings: market.strategySettings ?? {},
    conflictWarnings: market.conflictWarnings ?? [],
    exchangeCapabilities: market.exchangeCapabilities ?? null,
  }
}
