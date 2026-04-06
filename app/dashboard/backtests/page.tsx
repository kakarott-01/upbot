'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, CalendarRange, Loader2, Play, Trash2, X, CheckSquare, Square } from 'lucide-react'
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

// ── FIX: Use a safe default range (30 days ago) instead of 2017
// Many exchanges only support limited history windows per query.
// The "Use max range" button now sets a reasonable 90-day window
// that works reliably across exchanges including BingX.
const SAFE_MAX_DAYS = 90

function getSafeMaxRange(): { from: string; to: string } {
  const now = new Date()
  const from = new Date(now.getTime() - SAFE_MAX_DAYS * 24 * 60 * 60 * 1000)
  return {
    from: from.toISOString().slice(0, 16),
    to:   now.toISOString().slice(0, 16),
  }
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-gray-800 bg-gray-950/30 px-4 py-10 text-center">
      <p className="text-sm font-medium text-gray-200">{title}</p>
      <p className="mt-2 text-sm text-gray-500">{description}</p>
    </div>
  )
}

// ── Delete confirmation modal ─────────────────────────────────────────────────
function DeleteConfirmModal({
  count,
  onConfirm,
  onClose,
}: {
  count: number
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-red-900/40 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-red-900/30 bg-red-950/20">
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center">
            <Trash2 className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-300">Delete Backtest{count !== 1 ? 's' : ''}</p>
            <p className="text-xs text-red-400/70">This cannot be undone</p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-600 hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-300">
            Delete <span className="font-semibold text-white">{count}</span> backtest run{count !== 1 ? 's' : ''}?
          </p>
          <div className="flex gap-2">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors">
              Cancel
            </button>
            <button onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white transition-colors">
              Delete
            </button>
          </div>
        </div>
      </div>
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

  // ── Delete state ──────────────────────────────────────────────────────────
  const [selectedRuns, setSelectedRuns] = useState<Set<string>>(new Set())
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<{ ids: string[]; count: number } | null>(null)

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

  // ── Delete mutation ───────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const results = await Promise.all(
        ids.map((id) =>
          fetch(`/api/backtests/${id}`, { method: 'DELETE' }).then(async (r) => {
            if (!r.ok) {
              const d = await r.json().catch(() => ({}))
              throw new Error(d.error ?? `Failed to delete ${id}`)
            }
            return id
          })
        )
      )
      return results
    },
    onSuccess: (deletedIds) => {
      qc.invalidateQueries({ queryKey: ['backtest-runs'] })
      setSelectedRuns(new Set())
      setShowDeleteConfirm(null)
      pushToast({
        tone: 'success',
        title: `${deletedIds.length} backtest${deletedIds.length !== 1 ? 's' : ''} deleted`,
      })
    },
    onError: (err: Error) => {
      setShowDeleteConfirm(null)
      pushToast({ tone: 'error', title: 'Delete failed', description: err.message })
    },
  })

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

  // ── Selection helpers ─────────────────────────────────────────────────────
  const allRuns: any[] = runsData?.runs ?? []
  const allSelected = allRuns.length > 0 && selectedRuns.size === allRuns.length

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedRuns(new Set())
    } else {
      setSelectedRuns(new Set(allRuns.map((r: any) => r.id)))
    }
  }

  function toggleSelectRun(id: string) {
    setSelectedRuns((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const metrics = result?.performance_metrics
  const equityCurve = result?.equity_curve ?? []
  const tradeSummary = result?.trade_summary ?? []
  const selectedStrategyLabels = strategyKeys.length ? strategyKeys.join(' + ') : 'No strategies selected'

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5">
      {/* Delete confirm modal */}
      {showDeleteConfirm && (
        <DeleteConfirmModal
          count={showDeleteConfirm.count}
          onConfirm={() => deleteMutation.mutate(showDeleteConfirm.ids)}
          onClose={() => setShowDeleteConfirm(null)}
        />
      )}

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
            <InlineAlert tone="info" title="Date range tips">
              <div className="space-y-2">
                <p>Use the quick-set button for a reliable 90-day window. For wider ranges, set dates manually — exchange API limits vary by provider.</p>
                <button
                  type="button"
                  onClick={() => {
                    const range = getSafeMaxRange()
                    setDateFrom(range.from)
                    setDateTo(range.to)
                  }}
                  className="rounded-lg border border-brand-500/25 bg-brand-500/10 px-2.5 py-1.5 text-[11px] font-medium text-brand-300 transition hover:bg-brand-500/15"
                >
                  Use 90-day range
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

          {error ? (
            <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-3">
              <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-300 leading-relaxed">{error}</p>
            </div>
          ) : null}

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

          {/* ── Recent Runs with delete functionality ── */}
          <div className="card">
            <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-medium text-gray-300">Recent Runs</h2>
                <StatusBadge tone="neutral">{allRuns.length}</StatusBadge>
              </div>
              {/* Delete controls — shown when there are runs */}
              {allRuns.length > 0 && (
                <div className="flex items-center gap-2">
                  {selectedRuns.size > 0 && (
                    <button
                      onClick={() => setShowDeleteConfirm({ ids: Array.from(selectedRuns), count: selectedRuns.size })}
                      disabled={deleteMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/20 hover:bg-red-900/30 border border-red-900/30 rounded-lg transition-colors disabled:opacity-40"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete {selectedRuns.size} selected
                    </button>
                  )}
                  <button
                    onClick={() => setShowDeleteConfirm({ ids: allRuns.map((r: any) => r.id), count: allRuns.length })}
                    disabled={deleteMutation.isPending || allRuns.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/15 hover:bg-red-900/25 border border-red-900/30 rounded-lg transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete all
                  </button>
                </div>
              )}
            </div>

            {allRuns.length > 0 ? (
              <div className="space-y-2">
                {/* Select all row */}
                <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-gray-900/40 border border-gray-800/60">
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-gray-500 hover:text-brand-500 transition-colors flex-shrink-0"
                  >
                    {allSelected
                      ? <CheckSquare className="w-4 h-4 text-brand-500" />
                      : <Square className="w-4 h-4" />
                    }
                  </button>
                  <span className="text-xs text-gray-500">
                    {selectedRuns.size > 0 ? `${selectedRuns.size} of ${allRuns.length} selected` : 'Select all'}
                  </span>
                </div>

                {allRuns.map((run: any) => {
                  const isSelected = selectedRuns.has(run.id)
                  return (
                    <div
                      key={run.id}
                      className={`rounded-2xl border px-3 py-3 transition-colors ${
                        isSelected
                          ? 'border-brand-500/30 bg-brand-500/5'
                          : 'border-gray-800 bg-gray-950/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {/* Checkbox */}
                        <button
                          type="button"
                          onClick={() => toggleSelectRun(run.id)}
                          className="text-gray-600 hover:text-brand-500 transition-colors flex-shrink-0"
                        >
                          {isSelected
                            ? <CheckSquare className="w-4 h-4 text-brand-500" />
                            : <Square className="w-4 h-4" />
                          }
                        </button>

                        {/* Run info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm text-gray-200 font-medium">{run.asset}</p>
                            <span className="text-xs text-gray-600">·</span>
                            <p className="text-xs text-gray-400">{run.executionMode} · {run.positionMode ?? 'NET'}</p>
                          </div>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {(run.strategyKeys ?? []).join(', ')}
                          </p>
                          {run.performanceMetrics && (
                            <div className="mt-1.5 flex items-center gap-3 flex-wrap">
                              <span className={`text-xs font-semibold font-mono ${Number(run.performanceMetrics.totalReturnPct) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {Number(run.performanceMetrics.totalReturnPct) >= 0 ? '+' : ''}{run.performanceMetrics.totalReturnPct}%
                              </span>
                              <span className="text-xs text-gray-600">{run.performanceMetrics.winRate}% WR</span>
                              <span className="text-xs text-gray-600">DD {run.performanceMetrics.maxDrawdown}%</span>
                            </div>
                          )}
                        </div>

                        {/* Status + single delete */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <StatusBadge tone={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                            {run.status}
                          </StatusBadge>
                          <button
                            onClick={() => setShowDeleteConfirm({ ids: [run.id], count: 1 })}
                            disabled={deleteMutation.isPending}
                            className="p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
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