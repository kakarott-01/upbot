'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CalendarRange, Loader2, Play } from 'lucide-react'
import { ResponsiveContainer, LineChart, Line, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { StatusBadge } from '@/components/ui/status-badge'
import { InfoTip } from '@/components/ui/tooltip'
import { useToastStore } from '@/lib/toast-store'

const MARKETS = [
  { id: 'crypto', label: 'Crypto', category: 'CRYPTO' },
  { id: 'indian', label: 'Indian', category: 'STOCKS' },
  { id: 'global', label: 'Forex', category: 'STOCKS' },
  { id: 'commodities', label: 'Commodities', category: 'FOREX' },
] as const

type StrategyItem = {
  strategyKey: string
  name: string
  description: string
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
  supportedMarkets: string[]
  supportedTimeframes: string[]
}

const DEFAULT_ASSETS = {
  indian: 'RELIANCE',
  crypto: 'BTC/USDT',
  commodities: 'XAU/USD',
  global: 'SPY',
} as const

const MAX_RANGE_START = '2017-01-01T00:00'
const MAX_RANGE_HINT = 'Backtests fetch historical data in chunks, so you can use the broadest exchange-supported date range for the selected asset and timeframe.'

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/30 px-4 py-10 text-center">
      <p className="text-sm font-medium text-gray-200">{title}</p>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
    </div>
  )
}

export default function BacktestsPage() {
  const qc = useQueryClient()
  const pushToast = useToastStore((state) => state.push)
  const [marketType, setMarketType] = useState<'indian' | 'crypto' | 'commodities' | 'global'>('crypto')
  const [asset, setAsset] = useState<string>(DEFAULT_ASSETS.crypto)
  const [timeframe, setTimeframe] = useState('15m')
  const [executionMode, setExecutionMode] = useState<'SAFE' | 'AGGRESSIVE'>('SAFE')
  const [positionMode, setPositionMode] = useState<'NET' | 'HEDGE'>('NET')
  const [allowHedgeOpposition, setAllowHedgeOpposition] = useState(false)
  const [initialCapital, setInitialCapital] = useState(10000)
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 16))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 16))
  const [strategyKeys, setStrategyKeys] = useState<string[]>(['TREND_RIDER_V1'])
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: strategyData } = useQuery({
    queryKey: ['strategy-catalog'],
    queryFn: () => fetch('/api/strategies').then((response) => response.json()),
  })

  const { data: runsData } = useQuery({
    queryKey: ['backtest-runs'],
    queryFn: () => fetch('/api/backtests').then((response) => response.json()),
  })

  const { data: strategyConfigData } = useQuery({
    queryKey: ['strategy-configs'],
    queryFn: () => fetch('/api/strategy-config').then((response) => response.json()),
  })

  const strategies: StrategyItem[] = strategyData?.strategies ?? []
  const marketCategory = MARKETS.find((market) => market.id === marketType)?.category ?? 'CRYPTO'
  const filteredStrategies = useMemo(
    () => strategies.filter((strategy) => strategy.supportedMarkets.includes(marketCategory)),
    [marketCategory, strategies],
  )
  const timeframeOptions = useMemo(
    () => Array.from(new Set(filteredStrategies.flatMap((strategy) => strategy.supportedTimeframes))).sort((left, right) => timeframeToMinutes(left) - timeframeToMinutes(right)),
    [filteredStrategies],
  )

  useEffect(() => {
    setAsset(DEFAULT_ASSETS[marketType])
  }, [marketType])

  useEffect(() => {
    if (executionMode === 'SAFE') {
      setPositionMode('NET')
      setAllowHedgeOpposition(false)
    }
  }, [executionMode])

  useEffect(() => {
    setStrategyKeys((current) => current.filter((key) => filteredStrategies.some((strategy) => strategy.strategyKey === key)).slice(0, 2))
  }, [filteredStrategies])

  useEffect(() => {
    if (timeframeOptions.length === 0) return
    if (!timeframeOptions.includes(timeframe)) {
      setTimeframe(timeframeOptions[0])
    }
  }, [timeframe, timeframeOptions])

  const runMutation = useMutation({
    mutationFn: async () => {
      const savedMarketConfig = strategyConfigData?.markets?.find((market: any) => market.marketType === marketType)
      const strategySettings = Object.fromEntries(
        strategyKeys.map((key) => [key, savedMarketConfig?.strategySettings?.[key] ?? {
          priority: 'MEDIUM',
          cooldownAfterTradeSec: 0,
          capitalAllocation: { perTradePercent: 10, maxActivePercent: 25 },
          health: { minWinRatePct: 30, maxDrawdownPct: 15, maxLossStreak: 5, isAutoDisabled: false },
        }]),
      )
      const response = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketType,
          asset,
          timeframe,
          executionMode,
          positionMode,
          allowHedgeOpposition,
          initialCapital,
          dateFrom: new Date(dateFrom).toISOString(),
          dateTo: new Date(dateTo).toISOString(),
          strategyKeys,
          strategySettings,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Backtest failed')
      return data
    },
    onSuccess: (data) => {
      setResult(data)
      setError(null)
      qc.invalidateQueries({ queryKey: ['backtest-runs'] })
      pushToast({
        tone: 'success',
        title: 'Backtest completed',
        description: `${asset} · ${executionMode} · ${strategyKeys.join(' + ')}`,
      })
    },
    onError: (mutationError: Error) => {
      setError(mutationError.message)
      pushToast({
        tone: 'error',
        title: 'Backtest failed',
        description: mutationError.message,
      })
    },
  })

  const deployMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await fetch(`/api/backtests/${id}/deploy`, { method: 'POST' })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? 'Failed to deploy configuration')
      return data
    },
    onSuccess: () => {
      pushToast({
        tone: 'success',
        title: 'Configuration deployed',
        description: 'The market strategy configuration was updated from this backtest.',
      })
    },
    onError: (mutationError: Error) => {
      pushToast({
        tone: 'error',
        title: 'Deploy failed',
        description: mutationError.message,
      })
    },
  })

  function toggleStrategy(strategyKey: string) {
    setStrategyKeys((current) => {
      if (current.includes(strategyKey)) return current.filter((key) => key !== strategyKey)
      return [...current, strategyKey].slice(0, 2)
    })
  }

  const metrics = result?.performance_metrics
  const equityCurve = result?.equity_curve ?? []
  const tradeSummary = result?.trade_summary ?? []
  const selectedStrategyLabels = strategyKeys.length ? strategyKeys.join(' + ') : 'No strategies selected'

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      <div className="rounded-3xl border border-gray-800 bg-gradient-to-br from-gray-900 via-slate-950 to-gray-950 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-100">Backtests</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-gray-400">
              Run black-box strategies against historical data, compare SAFE and AGGRESSIVE behaviors, then deploy the configuration you trust.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="info">Server-side execution only</StatusBadge>
            <StatusBadge tone="neutral">Sticky run controls</StatusBadge>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
        <div className="card self-start xl:sticky xl:top-6">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-brand-500" />
            <h2 className="text-sm font-medium text-gray-200">Run Backtest</h2>
          </div>

          <div className="mt-4 space-y-4">
            <InlineAlert tone="info" title="Maximum history">
              <div className="space-y-2">
                <p>{MAX_RANGE_HINT}</p>
                <button
                  type="button"
                  onClick={() => setDateFrom(MAX_RANGE_START)}
                  className="rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-medium text-brand-300 transition hover:bg-brand-500/15"
                >
                  Use max range
                </button>
              </div>
            </InlineAlert>

            {executionMode === 'AGGRESSIVE' ? (
              <InlineAlert tone="danger" title="AGGRESSIVE mode enabled">
                Strategies run independently, capital is split per strategy, and hedge mode can allow opposing trades.
              </InlineAlert>
            ) : null}

            <label className="space-y-1.5">
              <span className="flex items-center gap-2 text-xs text-gray-500">
                Market
                <InfoTip text="Choose the market session whose strategy universe you want to simulate." />
              </span>
              <select value={marketType} onChange={(event) => setMarketType(event.target.value as any)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100">
                {MARKETS.map((market) => <option key={market.id} value={market.id}>{market.label}</option>)}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="flex items-center gap-2 text-xs text-gray-500">
                Asset
                <InfoTip text="Use the instrument format your exchange connector expects, like BTC/USDT or XAU/USD." />
              </span>
              <input value={asset} onChange={(event) => setAsset(event.target.value)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100" />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs text-gray-500">Timeframe</span>
                <select value={timeframe} onChange={(event) => setTimeframe(event.target.value)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100">
                  {timeframeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-gray-500">Initial capital</span>
                <input type="number" min={1000} value={initialCapital} onChange={(event) => setInitialCapital(Number(event.target.value) || 0)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100" />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="flex items-center gap-2 text-xs text-gray-500"><CalendarRange className="h-3.5 w-3.5" />From</span>
                <input type="datetime-local" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100" />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-gray-500">To</span>
                <input type="datetime-local" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100" />
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-gray-500">Execution mode</span>
              <div className="inline-flex w-full overflow-hidden rounded-xl border border-gray-800">
                {(['SAFE', 'AGGRESSIVE'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setExecutionMode(mode)}
                    className={`flex-1 px-3 py-2 text-xs font-medium transition ${
                      executionMode === mode
                        ? mode === 'AGGRESSIVE'
                          ? 'bg-red-500/15 text-red-200'
                          : 'bg-brand-500/15 text-brand-300'
                        : 'text-gray-500'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs text-gray-500">Position mode</span>
                <select
                  value={positionMode}
                  onChange={(event) => setPositionMode(event.target.value as 'NET' | 'HEDGE')}
                  disabled={executionMode !== 'AGGRESSIVE'}
                  className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 disabled:opacity-60"
                >
                  <option value="NET">NET</option>
                  <option value="HEDGE">HEDGE</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs text-gray-500">Hedge overlap</span>
                <select
                  value={allowHedgeOpposition ? 'allow' : 'block'}
                  onChange={(event) => setAllowHedgeOpposition(event.target.value === 'allow')}
                  disabled={positionMode !== 'HEDGE' || executionMode !== 'AGGRESSIVE'}
                  className="w-full rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5 text-sm text-gray-100 disabled:opacity-60"
                >
                  <option value="block">Block opposite overlap</option>
                  <option value="allow">Allow LONG + SHORT</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-gray-500">Strategies</span>
                <StatusBadge tone="neutral">{strategyKeys.length}/2 selected</StatusBadge>
              </div>
              <div className="grid gap-2">
                {filteredStrategies.length > 0 ? filteredStrategies.map((strategy) => {
                  const selected = strategyKeys.includes(strategy.strategyKey)
                  const supported = strategy.supportedTimeframes.includes(timeframe)
                  return (
                    <button
                      key={strategy.strategyKey}
                      type="button"
                      disabled={(!selected && strategyKeys.length >= 2) || !supported}
                      onClick={() => toggleStrategy(strategy.strategyKey)}
                      className={`rounded-2xl border p-3 text-left transition ${selected ? 'border-brand-500/40 bg-brand-500/10' : 'border-gray-800 bg-gray-950/60'} ${supported ? 'hover:border-gray-700' : 'opacity-50'} disabled:cursor-not-allowed`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-100">{strategy.name}</span>
                        <StatusBadge tone={strategy.riskLevel === 'HIGH' ? 'danger' : strategy.riskLevel === 'MEDIUM' ? 'warning' : 'success'}>
                          {strategy.riskLevel}
                        </StatusBadge>
                      </div>
                      <p className="mt-1 text-xs text-gray-400">{strategy.description}</p>
                      <p className="mt-2 text-[11px] text-gray-500">
                        {supported ? `Supports ${strategy.supportedTimeframes.join(', ')}` : `Not available on ${timeframe}`}
                      </p>
                    </button>
                  )
                }) : (
                  <EmptyState
                    title="No strategies selected"
                    description="This market has no compatible strategies for the current timeframe. Switch timeframe or market to continue."
                  />
                )}
              </div>
            </div>
          </div>

          {error ? <p className="mt-4 text-xs text-red-400">{error}</p> : null}

          <div className="sticky-actions mt-5">
            <div className="text-xs text-gray-500">
              {runMutation.isPending ? 'Running backtest… historical candles and metrics are loading.' : `Current selection: ${selectedStrategyLabels}`}
            </div>
            <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending || strategyKeys.length === 0}>
              {runMutation.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Running backtest...</>
              ) : (
                <><Play className="h-4 w-4" />Run Backtest</>
              )}
            </Button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="card">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-gray-300">Performance</h2>
              <StatusBadge tone="neutral">{result ? `${selectedStrategyLabels} · ${executionMode} · ${positionMode}` : 'Awaiting run'}</StatusBadge>
            </div>
            {metrics ? (
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
                <Metric title="Return" value={`${metrics.totalReturnPct}%`} />
                <Metric title="Win Rate" value={`${metrics.winRate}%`} />
                <Metric title="Max DD" value={`${metrics.maxDrawdown}%`} />
                <Metric title="Sharpe" value={String(metrics.sharpeRatio)} />
                <Metric title="Profit Factor" value={String(metrics.profitFactor)} />
              </div>
            ) : (
              <EmptyState title="No backtests yet" description="Run your first strategy test to see performance metrics, equity curve, and trade summary." />
            )}

            {result?.strategy_breakdown ? (
              <div className="mt-4 grid gap-3 md:grid-cols-2">
                {Object.entries(result.strategy_breakdown).map(([key, item]: any) => (
                  <div key={key} className="rounded-2xl border border-gray-800 bg-gray-950/60 px-3 py-3">
                    <div className="text-xs text-gray-500">{key}</div>
                    <div className="mt-1 text-sm text-gray-100">Return {item.totalReturnPct}%</div>
                    <div className="text-xs text-gray-400">Win rate {item.winRate}% · Max DD {item.maxDrawdown}%</div>
                  </div>
                ))}
              </div>
            ) : null}

            {result?.id ? (
              <div className="mt-4 flex justify-end">
                <Button onClick={() => deployMutation.mutate(result.id)} disabled={deployMutation.isPending}>
                  {deployMutation.isPending ? 'Deploying…' : 'Deploy this configuration'}
                </Button>
              </div>
            ) : null}
          </div>

          <div className="card">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-gray-300">Equity Curve</h2>
              <StatusBadge tone="neutral">{equityCurve.length} points</StatusBadge>
            </div>
            {equityCurve.length > 0 ? (
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityCurve}>
                    <CartesianGrid stroke="#1f2937" strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" hide />
                    <YAxis stroke="#6b7280" />
                    <Tooltip contentStyle={{ background: '#111827', border: '1px solid #374151' }} />
                    <Line type="monotone" dataKey="equity" stroke="#10b981" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState title="No equity curve yet" description="The equity curve will appear after a completed backtest run." />
            )}
          </div>

          <div className="card">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-sm font-medium text-gray-300">Trade Summary</h2>
              <StatusBadge tone="neutral">{tradeSummary.length} trades</StatusBadge>
            </div>
            {tradeSummary.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-left text-gray-500">
                      <th className="pb-2">#</th>
                      <th className="pb-2">Type</th>
                      <th className="pb-2">Result</th>
                      <th className="pb-2">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeSummary.map((trade: any) => (
                      <tr key={trade.tradeNumber} className="border-b border-gray-900 text-gray-300">
                        <td className="py-2">{trade.tradeNumber}</td>
                        <td className="py-2">{trade.tradeType}</td>
                        <td className={`py-2 ${trade.result >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{trade.result}%</td>
                        <td className="py-2">{trade.duration} bars</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No simulated trades yet" description="Trade-by-trade breakdown appears after the first successful backtest result." />
            )}
          </div>

          <div className="card">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-gray-300">Recent Runs</h2>
              <StatusBadge tone="neutral">{runsData?.runs?.length ?? 0}</StatusBadge>
            </div>
            {(runsData?.runs ?? []).length > 0 ? (
              <div className="space-y-2">
                {(runsData?.runs ?? []).map((run: any) => (
                  <div key={run.id} className="rounded-2xl border border-gray-800 bg-gray-950/60 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm text-gray-200">{run.asset} · {run.executionMode} · {run.positionMode ?? 'NET'}</p>
                        <p className="mt-1 text-xs text-gray-500">{(run.strategyKeys ?? []).join(', ')}</p>
                      </div>
                      <StatusBadge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                        {run.status}
                      </StatusBadge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No backtests yet" description="Run your first strategy test to build a comparison history." />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-950/60 px-3 py-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="mt-1 text-lg font-semibold text-gray-100">{value}</div>
    </div>
  )
}

function timeframeToMinutes(timeframe: string) {
  const value = Number(timeframe.slice(0, -1))
  const unit = timeframe.slice(-1)
  if (unit === 'm') return value
  if (unit === 'h') return value * 60
  if (unit === 'd') return value * 60 * 24
  return Number.MAX_SAFE_INTEGER
}
