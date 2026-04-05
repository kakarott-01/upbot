'use client'

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BarChart3, Loader2, Play } from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const MARKETS = [
  { id: 'indian', label: 'Indian', category: 'STOCKS' },
  { id: 'crypto', label: 'Crypto', category: 'CRYPTO' },
  { id: 'commodities', label: 'Commodities', category: 'FOREX' },
  { id: 'global', label: 'Global', category: 'STOCKS' },
] as const

export default function BacktestsPage() {
  const qc = useQueryClient()
  const [marketType, setMarketType] = useState<'indian' | 'crypto' | 'commodities' | 'global'>('crypto')
  const [asset, setAsset] = useState('BTC/USDT')
  const [timeframe, setTimeframe] = useState('15m')
  const [executionMode, setExecutionMode] = useState<'SAFE' | 'AGGRESSIVE'>('SAFE')
  const [initialCapital, setInitialCapital] = useState(10000)
  const [dateFrom, setDateFrom] = useState(() => new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString().slice(0, 16))
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 16))
  const [strategyKeys, setStrategyKeys] = useState<string[]>(['TREND_RIDER_V1'])
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: strategyData } = useQuery({
    queryKey: ['strategy-catalog'],
    queryFn: () => fetch('/api/strategies').then((r) => r.json()),
  })

  const { data: runsData } = useQuery({
    queryKey: ['backtest-runs'],
    queryFn: () => fetch('/api/backtests').then((r) => r.json()),
  })

  const strategies = strategyData?.strategies ?? []
  const marketCategory = MARKETS.find((market) => market.id === marketType)?.category ?? 'CRYPTO'
  const filteredStrategies = useMemo(
    () => strategies.filter((strategy: any) => strategy.supportedMarkets.includes(marketCategory)),
    [marketCategory, strategies],
  )

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/backtests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketType,
          asset,
          timeframe,
          executionMode,
          initialCapital,
          dateFrom: new Date(dateFrom).toISOString(),
          dateTo: new Date(dateTo).toISOString(),
          strategyKeys,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Backtest failed')
      return data
    },
    onSuccess: (data) => {
      setResult(data)
      setError(null)
      qc.invalidateQueries({ queryKey: ['backtest-runs'] })
    },
    onError: (err: Error) => {
      setError(err.message)
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

  return (
    <div className="space-y-5 max-w-7xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Backtests</h1>
          <p className="text-sm text-gray-500 mt-1">Run black-box strategies against historical data without exposing the internal logic.</p>
        </div>
        <div className="badge-gray">Server-side execution only</div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className="card space-y-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-brand-500" />
            <h2 className="text-sm font-medium text-gray-200">Run Backtest</h2>
          </div>

          {executionMode === 'AGGRESSIVE' && (
            <div className="bg-red-950/30 border border-red-900/40 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-red-200/85">
                Aggressive mode will simulate independent strategy decisions. Live trading also uses aggressive scopes,
                but opposite-direction overlap on the same symbol is blocked for safety.
              </p>
            </div>
          )}

          <div className="grid gap-3">
            <label className="space-y-1">
              <span className="text-xs text-gray-500">Market</span>
              <select value={marketType} onChange={(e) => setMarketType(e.target.value as any)} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100">
                {MARKETS.map((market) => <option key={market.id} value={market.id}>{market.label}</option>)}
              </select>
            </label>

            <label className="space-y-1">
              <span className="text-xs text-gray-500">Asset</span>
              <input value={asset} onChange={(e) => setAsset(e.target.value)} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100" />
            </label>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-gray-500">Timeframe</span>
                <input value={timeframe} onChange={(e) => setTimeframe(e.target.value)} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-500">Initial Capital</span>
                <input type="number" value={initialCapital} onChange={(e) => setInitialCapital(Number(e.target.value))} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100" />
              </label>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-xs text-gray-500">From</span>
                <input type="datetime-local" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100" />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-gray-500">To</span>
                <input type="datetime-local" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-100" />
              </label>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-gray-500">Execution Mode</span>
              <div className="inline-flex rounded-lg border border-gray-800 overflow-hidden">
                {(['SAFE', 'AGGRESSIVE'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setExecutionMode(mode)}
                    className={`px-3 py-2 text-xs font-medium ${executionMode === mode ? mode === 'AGGRESSIVE' ? 'bg-red-500/15 text-red-300' : 'bg-brand-500/15 text-brand-400' : 'text-gray-500'}`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <span className="text-xs text-gray-500">Strategies</span>
              <div className="grid gap-2">
                {filteredStrategies.map((strategy: any) => {
                  const selected = strategyKeys.includes(strategy.strategyKey)
                  return (
                    <button
                      key={strategy.strategyKey}
                      type="button"
                      disabled={!selected && strategyKeys.length >= 2}
                      onClick={() => toggleStrategy(strategy.strategyKey)}
                      className={`rounded-lg border p-3 text-left ${selected ? 'border-brand-500/40 bg-brand-500/10' : 'border-gray-800 bg-gray-950/60'} disabled:opacity-50`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-100">{strategy.name}</span>
                        <span className="text-[11px] text-gray-500">{strategy.riskLevel}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{strategy.description}</p>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button onClick={() => runMutation.mutate()} disabled={runMutation.isPending || strategyKeys.length === 0} className="btn-primary w-full">
            {runMutation.isPending ? <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Running…</span> : <><Play className="w-4 h-4" /> Run Backtest</>}
          </button>
        </div>

        <div className="space-y-5">
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-300">Performance</h2>
              <span className="badge-gray">{result ? `${strategyKeys.join(' + ')} · ${executionMode}` : 'Awaiting run'}</span>
            </div>
            {metrics ? (
              <div className="grid gap-3 md:grid-cols-5">
                <Metric title="Return" value={`${metrics.totalReturnPct}%`} />
                <Metric title="Win Rate" value={`${metrics.winRate}%`} />
                <Metric title="Max DD" value={`${metrics.maxDrawdown}%`} />
                <Metric title="Sharpe" value={String(metrics.sharpeRatio)} />
                <Metric title="Profit Factor" value={String(metrics.profitFactor)} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">Run a backtest to see metrics, equity curve, and trade summary.</p>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-300">Equity Curve</h2>
              <span className="badge-gray">{equityCurve.length} points</span>
            </div>
            <div className="h-80">
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
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-300">Trade Summary</h2>
              <span className="badge-gray">{tradeSummary.length} trades</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
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
          </div>

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-gray-300">Recent Runs</h2>
              <span className="badge-gray">{runsData?.runs?.length ?? 0}</span>
            </div>
            <div className="space-y-2">
              {(runsData?.runs ?? []).map((run: any) => (
                <div key={run.id} className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm text-gray-200">{run.asset} · {run.executionMode}</p>
                      <p className="text-xs text-gray-500">{(run.strategyKeys ?? []).join(', ')}</p>
                    </div>
                    <span className="text-xs text-gray-500">{run.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-3">
      <div className="text-xs text-gray-500">{title}</div>
      <div className="text-lg font-semibold text-gray-100 mt-1">{value}</div>
    </div>
  )
}
