'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Layers3, Loader2, Save } from 'lucide-react'

const MARKETS = [
  { id: 'indian', label: 'Indian Markets' },
  { id: 'crypto', label: 'Crypto' },
  { id: 'commodities', label: 'Commodities' },
  { id: 'global', label: 'Global' },
] as const

type MarketId = typeof MARKETS[number]['id']

type StrategyItem = {
  strategyKey: string
  name: string
  description: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  supportedMarkets: Array<'CRYPTO' | 'STOCKS' | 'FOREX'>
  supportedTimeframes: string[]
  historicalPerformance: {
    winRate: number
    averageReturn: number
    maxDrawdown: number
    sharpeRatio: number
  }
}

function marketCategory(market: MarketId) {
  if (market === 'crypto') return 'CRYPTO'
  if (market === 'commodities') return 'FOREX'
  return 'STOCKS'
}

export function StrategySettings() {
  const qc = useQueryClient()
  const [configs, setConfigs] = useState<Record<string, { executionMode: 'SAFE' | 'AGGRESSIVE'; strategyKeys: string[] }>>({})
  const [savedMarket, setSavedMarket] = useState<string | null>(null)

  const { data: strategyData, isLoading: strategiesLoading } = useQuery({
    queryKey: ['strategy-catalog'],
    queryFn: () => fetch('/api/strategies').then((r) => r.json()),
  })

  const { data: configData, isLoading: configsLoading } = useQuery({
    queryKey: ['strategy-configs'],
    queryFn: () => fetch('/api/strategy-config').then((r) => r.json()),
  })

  const { data: botData } = useQuery({
    queryKey: ['bot-status'],
    queryFn: () => fetch('/api/bot/status').then((r) => r.json()),
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (configData?.markets) {
      const next: Record<string, { executionMode: 'SAFE' | 'AGGRESSIVE'; strategyKeys: string[] }> = {}
      for (const market of configData.markets) {
        next[market.marketType] = {
          executionMode: market.executionMode,
          strategyKeys: market.strategyKeys,
        }
      }
      setConfigs(next)
    }
  }, [configData])

  const saveMutation = useMutation({
    mutationFn: async ({ marketType, config }: { marketType: MarketId; config: { executionMode: 'SAFE' | 'AGGRESSIVE'; strategyKeys: string[] } }) => {
      const res = await fetch('/api/strategy-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketType,
          executionMode: config.executionMode,
          strategyKeys: config.strategyKeys,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed to save strategy config')
      return data
    },
    onSuccess: (_data, vars) => {
      setSavedMarket(vars.marketType)
      qc.invalidateQueries({ queryKey: ['strategy-configs'] })
      setTimeout(() => setSavedMarket((current) => (current === vars.marketType ? null : current)), 2500)
    },
  })

  const strategies: StrategyItem[] = strategyData?.strategies ?? []
  const botIsLocked = botData?.status === 'running' || botData?.status === 'stopping'

  const strategiesByMarket = useMemo(() => {
    const result: Record<string, StrategyItem[]> = {}
    for (const market of MARKETS) {
      result[market.id] = strategies.filter((item) => item.supportedMarkets.includes(marketCategory(market.id)))
    }
    return result
  }, [strategies])

  function toggleStrategy(marketType: MarketId, strategyKey: string) {
    setConfigs((prev) => {
      const current = prev[marketType] ?? { executionMode: 'SAFE', strategyKeys: [] }
      const exists = current.strategyKeys.includes(strategyKey)
      const nextKeys = exists
        ? current.strategyKeys.filter((key) => key !== strategyKey)
        : [...current.strategyKeys, strategyKey].slice(0, 2)
      return { ...prev, [marketType]: { ...current, strategyKeys: nextKeys } }
    })
  }

  function setMode(marketType: MarketId, executionMode: 'SAFE' | 'AGGRESSIVE') {
    setConfigs((prev) => ({
      ...prev,
      [marketType]: {
        executionMode,
        strategyKeys: prev[marketType]?.strategyKeys ?? [],
      },
    }))
  }

  return (
    <div className="card space-y-5 overflow-hidden">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
        <Layers3 className="w-4 h-4 text-brand-500" />
        <div>
          <h2 className="text-sm font-medium text-gray-200">Strategy Engine</h2>
          <p className="text-xs text-gray-500 mt-0.5">Select up to 2 sealed strategies per market and save each market independently.</p>
        </div>
      </div>

      {botIsLocked && (
        <div className="bg-amber-900/15 border border-amber-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/80">
            Strategy changes are locked while the bot is running or stopping.
          </p>
        </div>
      )}

      {(strategiesLoading || configsLoading) && (
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading strategy catalog…
        </div>
      )}

      {!strategiesLoading && !configsLoading && MARKETS.map((market) => {
        const config = configs[market.id] ?? { executionMode: 'SAFE', strategyKeys: [] }
        const isAggressive = config.executionMode === 'AGGRESSIVE'
        return (
          <div key={market.id} className="rounded-2xl border border-gray-800 bg-gray-900/40 p-4 sm:p-5 space-y-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-100">{market.label}</h3>
                <p className="text-xs text-gray-500 mt-1 max-w-2xl">
                  `SAFE` requires agreement. `AGGRESSIVE` allows separate strategy-scoped positions.
                </p>
              </div>

              <div className="inline-flex w-full overflow-hidden rounded-xl border border-gray-700 sm:w-auto">
                {(['SAFE', 'AGGRESSIVE'] as const).map((mode) => (
                  <button
                    key={mode}
                    disabled={botIsLocked}
                    onClick={() => setMode(market.id, mode)}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition-colors sm:flex-none ${
                      config.executionMode === mode
                        ? mode === 'AGGRESSIVE'
                          ? 'bg-red-500/15 text-red-300'
                          : 'bg-brand-500/15 text-brand-400'
                        : 'text-gray-500 hover:text-gray-300'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {isAggressive && (
              <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-red-200/85">
                  Aggressive mode is enabled. Strategies can open independent live positions for the same symbol,
                  but opposite-direction overlap on one symbol is blocked for safety on netted exchange accounts.
                </p>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(strategiesByMarket[market.id] ?? []).map((strategy) => {
                const selected = config.strategyKeys.includes(strategy.strategyKey)
                return (
                  <button
                    key={strategy.strategyKey}
                    type="button"
                    disabled={botIsLocked || (!selected && config.strategyKeys.length >= 2)}
                    onClick={() => toggleStrategy(market.id, strategy.strategyKey)}
                    className={`text-left rounded-2xl border p-4 transition-colors ${
                      selected
                        ? 'border-brand-500/50 bg-brand-500/10'
                        : 'border-gray-800 bg-gray-950/60 hover:border-gray-700'
                    } disabled:opacity-50 disabled:cursor-not-allowed`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-gray-100 break-words">{strategy.name}</span>
                      <span className={`text-[11px] px-2 py-0.5 rounded-full border ${
                        strategy.riskLevel === 'HIGH'
                          ? 'border-red-900/40 text-red-300 bg-red-950/30'
                          : strategy.riskLevel === 'MEDIUM'
                          ? 'border-amber-900/40 text-amber-300 bg-amber-950/30'
                          : 'border-emerald-900/40 text-emerald-300 bg-emerald-950/30'
                      }`}>
                        {strategy.riskLevel}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">{strategy.description}</p>
                    <div className="mt-4 grid grid-cols-1 gap-1 text-[11px] text-gray-500 sm:grid-cols-3">
                      <div>Win rate {strategy.historicalPerformance.winRate}%</div>
                      <div>Avg return {strategy.historicalPerformance.averageReturn}%</div>
                      <div>Max DD {strategy.historicalPerformance.maxDrawdown}%</div>
                    </div>
                  </button>
                )
              })}
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-800/80 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-gray-500 break-words">
                Selected: {config.strategyKeys.length ? config.strategyKeys.join(', ') : 'None'}
              </p>
              <button
                onClick={() => saveMutation.mutate({ marketType: market.id, config })}
                disabled={botIsLocked || saveMutation.isPending || config.strategyKeys.length === 0}
                className="btn-primary w-full sm:w-auto"
              >
                {saveMutation.isPending ? (
                  <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Saving…</span>
                ) : savedMarket === market.id ? (
                  '✓ Saved'
                ) : (
                  <><Save className="w-4 h-4" /> Save</>
                )}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
