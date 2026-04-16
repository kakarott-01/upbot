'use client'

import { useState, type ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/query-keys'
import dynamic from 'next/dynamic'
import { apiFetch } from '@/lib/api-client'
import {
  TrendingUp, TrendingDown, Target, Activity,
  Award, AlertTriangle, BarChart2, Banknote, Wallet,
  Zap, RefreshCw,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import {
  getMarketCurrency,
  formatAmount,
  formatPnlAmount,
  type MarketCurrency,
} from '@/lib/currency'
import type { LiveBalanceData } from '@/app/api/exchange/balance/route'

const PerformanceCharts = dynamic(
  () => import('@/components/charts/performance-charts'),
  { ssr: false },
)

// ── Types ─────────────────────────────────────────────────────────────────────

type DailyRow = {
  date:   string
  pnl:    number
  fees:   number
  trades: number
  wins:   number
  losses: number
}

type PerformanceResponse = {
  summary: {
    total: number; open: number; closed: number; winners: number; losers: number
    totalPnl: number; totalFees: number; avgWin: number; avgLoss: number
    bestTrade: number; worstTrade: number; winRate: number; riskReward: number
    paperCount: number; liveCount: number
  }
  dailyPnl:       DailyRow[]
  byMarket:       Array<{ market: string; total: number; closed: number; winners: number; pnl: number; fees: number }>
  cumPnl:         Array<{ date: string; pnl: number }>
  principle?:     number
  currentBalance?:number
  totalFees?:     number
  totalTrades?:   number
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="stat-card">
      <div className="h-3 w-20 bg-gray-800 rounded animate-pulse mb-2" />
      <div className="h-6 w-28 bg-gray-800 rounded animate-pulse mb-1" />
      <div className="h-3 w-16 bg-gray-800 rounded animate-pulse" />
    </div>
  )
}

function BalanceCard({
  label, value, sub, color, icon: Icon, badge,
}: {
  label: string; value: string; sub: string; color: string; icon: ElementType; badge?: React.ReactNode
}) {
  return (
    <div className="card flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">{label}</span>
        <div className="flex items-center gap-1.5">
          {badge}
          <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gray-800">
            <Icon className={`w-4 h-4 ${color}`} />
          </div>
        </div>
      </div>
      <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      <p className="text-xs text-gray-600">{sub}</p>
    </div>
  )
}

function SkeletonRow() {
  return (
    <tr className="border-b border-gray-800/50">
      {[60, 80, 70, 40, 55].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3.5 bg-gray-800 rounded animate-pulse" style={{ width: `${w}%` }} />
        </td>
      ))}
    </tr>
  )
}

function WrBadge({ wins, total }: { wins: number; total: number }) {
  if (!total) return <span className="text-gray-600 text-xs">-</span>
  const wr = Math.round((wins / total) * 100)
  return (
    <span className={`text-xs font-medium ${wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
      {wr}%
    </span>
  )
}

// ── Live Badge ─────────────────────────────────────────────────────────────────

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
      LIVE
    </span>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

const MARKETS  = ['all', 'indian', 'crypto', 'commodities', 'global'] as const
const MODES    = ['paper', 'live'] as const
type MarketFilter = typeof MARKETS[number]
type ModeFilter   = typeof MODES[number]

export default function PerformancePage() {
  const [mode,   setMode]   = useState<ModeFilter>('paper')
  const [market, setMarket] = useState<MarketFilter>('all')

  const params = new URLSearchParams()
  params.set('mode', mode)
  if (market !== 'all') params.set('market', market)

  const qs       = params.toString()
  const perfPath = qs ? `/api/performance?${qs}` : '/api/performance'
  const filters  = market !== 'all' ? { mode, market } : { mode }

  const { data, isLoading } = useQuery<PerformanceResponse>({
    queryKey: QUERY_KEYS.PERFORMANCE(filters),
    queryFn:  () => apiFetch<PerformanceResponse>(perfPath),
    staleTime: 30_000,
  })

  // ── Live exchange balance (only when mode=live) ──────────────────────────
  const { data: liveBalanceData, isLoading: liveBalanceLoading, refetch: refetchBalance } = useQuery<LiveBalanceData>({
    queryKey: ['exchange-live-balance'],
    queryFn:  () => apiFetch<LiveBalanceData>('/api/exchange/balance'),
    enabled:  mode === 'live',
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  // Per-market live balance when a specific market is selected
  const liveMktBalance = (mode === 'live' && market !== 'all')
    ? (liveBalanceData?.markets?.[market]?.balance ?? null)
    : null
  const liveBalanceAvailable = liveMktBalance !== null && liveBalanceData?.running === true
  const liveBalanceCurrency   = liveBalanceData?.markets?.[market]?.currency ?? null

  // Currency for this view
  const displayCurrency: MarketCurrency =
    market !== 'all' ? getMarketCurrency(market) : 'INR'
  const isMixed = market === 'all'

  const s            = data?.summary
  const dailyRows    = data?.dailyPnl ?? []
  const byMarket     = data?.byMarket ?? []
  const cumPnl       = data?.cumPnl ?? []
  const principle    = data?.principle    ?? 0
  const currentBalance = data?.currentBalance ?? 0
  const totalFees    = data?.totalFees    ?? 0
  const totalTrades  = data?.totalTrades  ?? 0
  const totalPnl     = s?.totalPnl        ?? 0

  const balanceChangePct = principle > 0 ? ((currentBalance - principle) / principle) * 100 : 0
  const todayIso         = new Date().toISOString().slice(0, 10)
  const todayPnl         = dailyRows.find((r) => r.date === todayIso)?.pnl ?? 0

  // Effective balance values: use live exchange balance when available
  const effectivePrinciple      = liveBalanceAvailable ? null : principle
  const effectiveCurrentBalance = liveBalanceAvailable ? liveMktBalance! : currentBalance
  const effectiveBalanceChangePct = (liveBalanceAvailable || principle === 0)
    ? null
    : balanceChangePct

  const metrics = s ? [
    {
      label: 'Net P&L',
      value: formatPnlAmount(s.totalPnl, displayCurrency),
      sub:   isMixed ? '⚠ Mixed currencies — filter by market' : `${s.closed} closed trades`,
      color: s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon:  s.totalPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: 'Fees Paid',
      value: formatAmount(s.totalFees, displayCurrency),
      sub:   'Entry + exit costs',
      color: 'text-amber-400',
      icon:  AlertTriangle,
    },
    {
      label: 'Win Rate',
      value: `${s.winRate.toFixed(1)}%`,
      sub:   `${s.winners}W / ${s.losers}L`,
      color: s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400',
      icon:  Target,
    },
    {
      label: 'Risk : Reward',
      value: `1 : ${s.riskReward.toFixed(2)}`,
      sub:   s.riskReward >= 1.5 ? 'Good ratio' : 'Below target',
      color: s.riskReward >= 1.5 ? 'text-emerald-400' : 'text-amber-400',
      icon:  Activity,
    },
    {
      label: 'Avg Win',
      value: formatAmount(s.avgWin, displayCurrency),
      sub:   `Best: ${formatAmount(s.bestTrade, displayCurrency)}`,
      color: 'text-emerald-400',
      icon:  TrendingUp,
    },
    {
      label: 'Avg Loss',
      value: formatAmount(Math.abs(s.avgLoss), displayCurrency),
      sub:   `Worst: ${formatAmount(Math.abs(s.worstTrade), displayCurrency)}`,
      color: 'text-red-400',
      icon:  TrendingDown,
    },
    {
      label: 'Total Trades',
      value: s.total,
      sub:   `${s.open} open · ${s.closed} closed`,
      color: 'text-gray-200',
      icon:  BarChart2,
    },
    {
      label: 'Paper Trades',
      value: s.paperCount,
      sub:   'Simulated',
      color: 'text-amber-400',
      icon:  Award,
    },
    {
      label: 'Live Trades',
      value: s.liveCount,
      sub:   'Real money',
      color: s.liveCount > 0 ? 'text-red-400' : 'text-gray-500',
      icon:  AlertTriangle,
    },
    // Principle Capital — hidden when live balance is available (exchange IS the principle)
    ...(!liveBalanceAvailable ? [{
      label: 'Principle Capital',
      value: formatAmount(principle, displayCurrency),
      sub: isMixed ? 'Crypto: USDT · Indian: INR' : 'Starting capital',
      color: 'text-gray-200',
      icon:  Banknote,
    }] : []),
    {
      label: liveBalanceAvailable ? 'Exchange Balance' : 'Current Balance',
      value: formatAmount(effectiveCurrentBalance, displayCurrency),
      sub: liveBalanceAvailable
        ? `Live ${market} · ${liveBalanceCurrency ?? displayCurrency} available`
        : effectiveBalanceChangePct !== null
          ? `${effectiveBalanceChangePct >= 0 ? '+' : ''}${effectiveBalanceChangePct.toFixed(2)}% · ${formatPnlAmount(todayPnl, displayCurrency)} today`
          : `${formatPnlAmount(todayPnl, displayCurrency)} today`,
      color: liveBalanceAvailable
        ? 'text-emerald-400'
        : effectiveCurrentBalance >= principle ? 'text-emerald-400' : 'text-red-400',
      icon:  Wallet,
      badge: liveBalanceAvailable ? <LiveBadge /> : undefined,
    },
  ] : []

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header + filters */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Performance</h1>
          {isMixed && !isLoading && (
            <p className="text-xs text-amber-500/80 mt-1">
              Showing all markets — crypto in USDT, Indian/Commodities in INR, Global in USD. Filter by market for comparable values.
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Mode refresh button for live balance */}
          {mode === 'live' && market !== 'all' && (
            <button
              onClick={() => refetchBalance()}
              disabled={liveBalanceLoading}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-40"
              title="Refresh exchange balance"
            >
              <RefreshCw className={`w-3 h-3 ${liveBalanceLoading ? 'animate-spin' : ''}`} />
              Refresh balance
            </button>
          )}
          <div className="flex gap-1.5">
            {MODES.map((value) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  mode === value
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex gap-1.5">
            {MARKETS.map((value) => (
              <button
                key={value}
                onClick={() => setMarket(value)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  market === value
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live mode info banner */}
      {mode === 'live' && market !== 'all' && (
        <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${
          liveBalanceAvailable
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : liveBalanceLoading
              ? 'bg-gray-800/40 border-gray-700'
              : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          {liveBalanceAvailable ? (
            <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          )}
          <div>
            {liveBalanceAvailable ? (
              <p className="text-sm text-emerald-300 font-medium">
                Exchange balance fetched live from {market} connector
              </p>
            ) : liveBalanceLoading ? (
              <p className="text-sm text-gray-400">Fetching exchange balance…</p>
            ) : (
              <p className="text-sm text-amber-300">
                Bot is not running — showing calculated balance (principle + realized P&L).
                Start the bot to see live exchange balance.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} />)
          : metrics.map((metric) => {
              const Icon = metric.icon
              const badge = (metric as any).badge
              return (
                <div key={metric.label} className="stat-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">{metric.label}</span>
                    <div className="flex items-center gap-1.5">
                      {badge}
                      <Icon className="w-3.5 h-3.5 text-gray-700" />
                    </div>
                  </div>
                  <span className={`text-xl font-semibold ${metric.color}`}>{metric.value}</span>
                  <p className="stat-sub">{metric.sub}</p>
                </div>
              )
            })}
      </div>

      {/* Charts — pass marketFilter so they show correct currency */}
      <PerformanceCharts
        isLoading={isLoading}
        cumPnl={cumPnl}
        daily={dailyRows}
        byMarket={byMarket}
        marketFilter={market}
      />

      {/* Daily breakdown table */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-gray-300">Daily Balance</h2>
          <p className="mt-1 text-xs text-gray-500">
            Day-by-day outcomes for the selected market and mode.
            {!isMixed && ` Values in ${displayCurrency === 'INR' ? '₹ INR' : displayCurrency === 'USDT' ? '$ USDT' : '$ USD'}.`}
          </p>
        </div>

        <div className="card overflow-hidden p-0">
          <div className="px-5 py-3.5 border-b border-gray-800">
            <h2 className="text-sm font-medium text-gray-300">Day-by-Day Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  {['Date', 'Net P&L', 'Fees', 'Trades', 'Win Rate'].map((heading) => (
                    <th
                      key={heading}
                      className="text-left text-xs text-gray-600 font-medium pb-3 pt-3.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {isLoading ? (
                  Array.from({ length: 7 }).map((_, index) => <SkeletonRow key={index} />)
                ) : dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-14 text-sm text-gray-600">
                      No closed trades found for the selected filters
                    </td>
                  </tr>
                ) : (
                  dailyRows.map((row) => (
                    <tr key={row.date} className="hover:bg-gray-800/25 transition-colors">
                      <td className="py-3 px-3 pl-5 text-xs text-gray-300 whitespace-nowrap font-medium">
                        {format(parseISO(row.date), 'EEE, dd MMM yyyy')}
                      </td>
                      <td className="py-3 px-3">
                        <span className={`text-xs font-semibold font-mono ${row.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {formatPnlAmount(row.pnl, displayCurrency)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-gray-500 font-mono">
                        {formatAmount(row.fees, displayCurrency)}
                      </td>
                      <td className="py-3 px-3">
                        <span className="text-xs text-gray-300">{row.trades}</span>
                        <span className="text-xs text-gray-600 ml-1.5">
                          ({row.wins}W/{row.losses}L)
                        </span>
                      </td>
                      <td className="py-3 px-3 pr-5">
                        <WrBadge wins={row.wins} total={row.trades} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {dailyRows.length > 0 && !isLoading && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900/40">
              <span className="text-xs text-gray-500">{dailyRows.length} trading days shown</span>
              <div className="flex items-center gap-6 text-xs">
                <span className="text-gray-600">
                  Total fees:{' '}
                  <span className="text-gray-400 font-mono">
                    {formatAmount(totalFees, displayCurrency)}
                  </span>
                </span>
                <span className="text-gray-600">
                  Total trades: <span className="text-gray-400">{totalTrades}</span>
                </span>
                <span className={`font-semibold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPnlAmount(totalPnl, displayCurrency)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}