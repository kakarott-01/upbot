'use client'

import { useState, type ElementType } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
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
import { BOT_STATUS_QUERY_KEY } from '@/lib/bot-status-client'
import type { LiveBalanceData } from '@/app/api/exchange/balance/route'
import { SectionErrorBoundary } from '@/components/ui/section-error-boundary'

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
  dailyPnl:        DailyRow[]
  byMarket:        Array<{ market: string; total: number; closed: number; winners: number; pnl: number; fees: number }>
  cumPnl:          Array<{ date: string; pnl: number }>
  principle?:      number
  currentBalance?: number
  totalFees?:      number
  totalTrades?:    number
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

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
      <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
      LIVE
    </span>
  )
}

// ── Markets — no 'all', defaults to specific market ───────────────────────────
const MARKETS  = ['crypto', 'indian', 'commodities', 'global'] as const
const MODES    = ['paper', 'live'] as const
type MarketFilter = typeof MARKETS[number]
type ModeFilter   = typeof MODES[number]

function getPreferredMarket(activeMarkets?: readonly string[]): MarketFilter {
  const activeMarket = activeMarkets?.find((item): item is MarketFilter => (
    MARKETS.includes(item as MarketFilter)
  ))

  return activeMarket ?? 'indian'
}

export default function PerformancePage() {
  const queryClient = useQueryClient()

  const [market, setMarket] = useState<MarketFilter>(() => {
    const cachedBotData = queryClient.getQueryData<{ activeMarkets?: string[] }>(BOT_STATUS_QUERY_KEY)
    return getPreferredMarket(cachedBotData?.activeMarkets)
  })
  const [mode,   setMode]   = useState<ModeFilter>('paper')

  const params = new URLSearchParams({ mode, market })
  const perfPath = `/api/performance?${params.toString()}`

  const { data, isLoading } = useQuery<PerformanceResponse>({
    queryKey: QUERY_KEYS.PERFORMANCE({ mode, market }),
    queryFn:  () => apiFetch<PerformanceResponse>(perfPath),
    select: (response) => ({
      summary: response.summary,
      dailyPnl: response.dailyPnl,
      byMarket: response.byMarket,
      cumPnl: response.cumPnl,
      principle: response.principle,
      currentBalance: response.currentBalance,
      totalFees: response.totalFees,
      totalTrades: response.totalTrades,
    }),
    staleTime: 30_000,
  })

  // Live exchange balance (only for live mode)
  const {
    data: liveBalanceData,
    isLoading: liveBalanceLoading,
    refetch: refetchBalance,
  } = useQuery<LiveBalanceData>({
    queryKey: ['exchange-live-balance'],
    queryFn:  () => apiFetch<LiveBalanceData>('/api/exchange/balance'),
    enabled:  mode === 'live',
    staleTime: 15_000,
    refetchInterval: 30_000,
  })

  const liveMktBalance = mode === 'live'
    ? (liveBalanceData?.markets?.[market]?.balance ?? null)
    : null
  const liveBalanceAvailable = liveMktBalance !== null && liveBalanceData?.running === true
  const liveBalanceCurrency   = liveBalanceData?.markets?.[market]?.currency ?? null

  const displayCurrency: MarketCurrency = getMarketCurrency(market)

  const s            = data?.summary
  const dailyRows    = data?.dailyPnl ?? []
  const byMarket     = data?.byMarket ?? []
  const cumPnl       = data?.cumPnl ?? []
  const principle    = data?.principle    ?? 0
  const currentBalance = data?.currentBalance ?? 0
  const totalFees    = data?.totalFees    ?? 0
  const totalTrades  = data?.totalTrades  ?? 0
  const totalPnl     = s?.totalPnl ?? 0
  const pageLoading = isLoading

  const balanceChangePct = principle > 0 ? ((currentBalance - principle) / principle) * 100 : 0
  const todayIso = new Date().toISOString().slice(0, 10)
  const todayPnl = dailyRows.find((r) => r.date === todayIso)?.pnl ?? 0

  const effectiveCurrentBalance = liveBalanceAvailable ? liveMktBalance! : currentBalance
  const effectiveBalanceChangePct = (liveBalanceAvailable || principle === 0) ? null : balanceChangePct

  // Metrics — removed paperCount and liveCount cards (use filter instead)
  const metrics = s ? [
    {
      label: 'Net P&L',
      value: formatPnlAmount(s.totalPnl, displayCurrency),
      sub:   `${s.closed} closed trades`,
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
    // Principle Capital — only shown when no live balance available
    ...(!liveBalanceAvailable ? [{
      label: 'Principle Capital',
      value: formatAmount(principle, displayCurrency),
      sub:   'Starting capital for this market',
      color: 'text-gray-200',
      icon:  Banknote,
    }] : []),
    {
      label: liveBalanceAvailable ? 'Exchange Balance' : 'Current Balance',
      value: formatAmount(effectiveCurrentBalance, displayCurrency),
      sub:   liveBalanceAvailable
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

  const MARKET_LABELS: Record<string, string> = {
    crypto:      '₿ Crypto',
    indian:      '🇮🇳 Indian',
    commodities: '🛢 Commodities',
    global:      '🌐 Global',
  }

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* Header + filters */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Performance</h1>
          <p className="text-xs text-gray-500 mt-1">
            {`${MARKET_LABELS[market]} · ${mode === 'paper' ? '🟡 Paper' : '🔴 Live'}`}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {mode === 'live' && (
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

          {/* Mode filter */}
          <div className="flex gap-1.5">
            {MODES.map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  mode === m
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {/* Market filter — no 'all' */}
          <div className="flex gap-1.5 flex-wrap">
            {MARKETS.map((m) => (
              <button
                key={m}
                onClick={() => setMarket(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  market === m
                    ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}
              >
                {MARKET_LABELS[m]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Live mode info banner */}
      {mode === 'live' && (
        <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${
          liveBalanceAvailable
            ? 'bg-emerald-500/5 border-emerald-500/20'
            : liveBalanceLoading
              ? 'bg-gray-800/40 border-gray-700'
              : 'bg-amber-500/5 border-amber-500/20'
        }`}>
          {liveBalanceAvailable
            ? <Zap className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            : <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          }
          <p className={`text-sm ${liveBalanceAvailable ? 'text-emerald-300' : 'text-amber-300'}`}>
            {liveBalanceAvailable
              ? `Exchange balance fetched live from ${market} connector`
              : liveBalanceLoading
                ? 'Fetching exchange balance…'
                : 'Bot is not running — showing calculated balance. Start the bot to see live exchange balance.'
            }
          </p>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {pageLoading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
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

      {/* Charts */}
      <SectionErrorBoundary>
        <PerformanceCharts
          isLoading={pageLoading}
          cumPnl={cumPnl}
          daily={dailyRows}
          byMarket={byMarket}
          marketFilter={market}
        />
      </SectionErrorBoundary>

      {/* Daily breakdown table */}
      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-gray-300">Daily Balance</h2>
          <p className="mt-1 text-xs text-gray-500">
            Day-by-day outcomes for {MARKET_LABELS[market]} · {mode} mode.
            Values in {displayCurrency === 'INR' ? '₹ INR' : displayCurrency === 'USDT' ? '$ USDT' : '$ USD'}.
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
                  {['Date', 'Net P&L', 'Fees', 'Trades', 'Win Rate'].map((h) => (
                    <th
                      key={h}
                      className="text-left text-xs text-gray-600 font-medium pb-3 pt-3.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/50">
                {pageLoading ? (
                  Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
                ) : dailyRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-center py-14 text-sm text-gray-600">
                      No closed trades found for {MARKET_LABELS[market]} in {mode} mode
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

          {dailyRows.length > 0 && !pageLoading && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900/40">
              <span className="text-xs text-gray-500">{dailyRows.length} trading days shown</span>
              <div className="flex items-center gap-6 text-xs">
                <span className="text-gray-600">
                  Fees: <span className="text-gray-400 font-mono">{formatAmount(totalFees, displayCurrency)}</span>
                </span>
                <span className="text-gray-600">
                  Trades: <span className="text-gray-400">{totalTrades}</span>
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
