"use client";
import { useQuery } from "@tanstack/react-query";
import { useBotStatusQuery } from '@/lib/use-bot-status-query'
import { QUERY_KEYS } from '@/lib/query-keys'
import { POLL_INTERVALS } from '@/lib/polling-config'
import { apiFetch } from '@/lib/api-client'

type StrategyCatalogResponse = { strategies?: any[] }
type StrategyCatalogSelected = StrategyCatalogResponse & { strategiesByMarket: Record<string, any[]> }
type StrategyConfigDataResponse = { markets?: any[] }
type RiskSettingsResponse = { paperBalance?: number }
type StrategyContextResponse = StrategyCatalogResponse & {
  markets?: any[]
  riskSettings?: RiskSettingsResponse
}
type StrategyContextSelected = StrategyContextResponse & {
  strategiesByMarket: Record<string, any[]>
}

export function useStrategySettings() {
  const { data: strategyContext, isLoading: contextLoading } = useQuery<StrategyContextResponse, unknown, StrategyContextSelected>({
    queryKey: QUERY_KEYS.STRATEGY_CONTEXT,
    queryFn: () => apiFetch('/api/strategy-context'),
    staleTime: POLL_INTERVALS.STRATEGY,
    select: (data) => {
      const strategies = data.strategies ?? []
      const MARKET_MAP: Record<string, string> = {
        crypto: 'CRYPTO',
        indian: 'STOCKS',
        global: 'STOCKS',
        commodities: 'FOREX',
      }
      const strategiesByMarket: Record<string, any[]> = { crypto: [], indian: [], global: [], commodities: [] }
      for (const s of strategies) {
        const supported: string[] = s.supportedMarkets ?? []
        for (const marketId of Object.keys(MARKET_MAP)) {
          if (supported.includes(MARKET_MAP[marketId])) {
            strategiesByMarket[marketId].push(s)
          }
        }
      }
      return {
        ...data,
        strategies,
        strategiesByMarket,
      }
    },
  })

  const { data: botData } = useBotStatusQuery({
    select: (data) => ({
      activeMarkets: data.activeMarkets,
    }),
  })

  const strategyData: StrategyCatalogSelected | undefined = strategyContext
    ? {
        strategies: strategyContext.strategies ?? [],
        strategiesByMarket: strategyContext.strategiesByMarket,
      }
    : undefined
  const configData: StrategyConfigDataResponse | undefined = strategyContext
    ? { markets: strategyContext.markets ?? [] }
    : undefined
  const riskData: RiskSettingsResponse | undefined = strategyContext?.riskSettings

  return {
    strategyData,
    strategiesLoading: contextLoading,
    configData,
    configsLoading: contextLoading,
    riskData,
    botData,
  }
}
