'use client'
import { useQuery } from '@tanstack/react-query'
import { QUERY_KEYS } from '@/lib/query-keys'
import {
  TrendingUp, TrendingDown, Activity,
  BarChart3, Layers, ArrowUpRight,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { POLL_INTERVALS } from '@/lib/polling-config'
const PnlChart = dynamic(() => import('@/components/charts/pnl-chart').then(m => m.PnlChart), { ssr: false, loading: () => <div className="h-40 flex items-center justify-center text-sm text-gray-600">Loading chart…</div> })
const TradeTable = dynamic(() => import('@/components/dashboard/trade-table').then(m => m.TradeTable))
import type { Trade } from '@/components/dashboard/trade-table'
const BotControls = dynamic(() => import('@/components/dashboard/bot-controls').then(m => m.BotControls))
import { useBotStatusQuery } from '@/lib/use-bot-status-query'
import { apiFetch } from '@/lib/api-client'
import {
  getMarketCurrency,
  formatAmount,
  formatPnlAmount,
  type MarketCurrency,
} from '@/lib/currency'

type TradesSummaryResponse = {
  total: number
  closed: number
  totalPnl: number
  totalFees: number
  winRate: number
  avgWin?: number
  avgLoss?: number
}

type PerformanceResponse = {
  cumPnl?: Array<{ date: string; pnl: number }>
  byMarket?: Array<{ market: string; total: number; closed: number; winners: number; pnl: number; fees: number }>
}

type TradesResponse = {
  trades?: unknown[]
}

type StrategyConfigListResponse = {
  markets?: Array<{ marketType: string; executionMode?: string }>
}

// ── Compact stat card ─────────────────────────────────────────────────────────
function StatCard({
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string; value: string; sub: string; color: string; icon: React.ElementType
}) {
  return (
    <div className="card flex flex-col gap-2 min-w-0 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">{label}</span>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${
          color === 'text-emerald-400' ? 'bg-emerald-400/10' :
          color === 'text-red-400'     ? 'bg-red-400/10' :
          color === 'text-brand-500'   ? 'bg-brand-500/10' :
          'bg-gray-800'
        }`}>
          <Icon className={`w-3.5 h-3.5 ${color}`} />
        </div>
      </div>
      <div>
        <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
        <p className="text-xs text-gray-600 mt-0.5">{sub}</p>
      </div>
    </div>
  )
}

// ── Per-market P&L card (replaces confusing mixed NET P&L) ────────────────────
const MARKET_PNL_INFO: Record<string, { emoji: string; label: string; currency: MarketCurrency }> = {
  crypto:      { emoji: '₿', label: 'Crypto',      currency: 'USDT' },
  indian:      { emoji: '🇮🇳', label: 'Indian',    currency: 'INR'  },
  commodities: { emoji: '🛢', label: 'Commodities', currency: 'INR'  },
  global:      { emoji: '🌐', label: 'Global',      currency: 'USD'  },
}

function PnLByMarketCard({
  byMarket,
  isLoading,
}: {
  byMarket: Array<{ market: string; closed: number; pnl: number }>
  isLoading: boolean
}) {
  const tradedMarkets = byMarket.filter(m => m.closed > 0)

  if (isLoading) {
    return (
      <div className="card flex flex-col gap-2 min-w-0 hover:border-gray-700 transition-colors">
        <div className="h-3 w-20 bg-gray-800 rounded animate-pulse" />
        <div className="h-4 w-28 bg-gray-800 rounded animate-pulse mt-1" />
        <div className="h-4 w-24 bg-gray-800 rounded animate-pulse" />
        <div className="h-3 w-16 bg-gray-800 rounded animate-pulse mt-1" />
      </div>
    )
  }

  if (tradedMarkets.length === 0) {
    return (
      <div className="card flex flex-col gap-2 min-w-0 hover:border-gray-700 transition-colors">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">P&L by Market</span>
          <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-gray-800">
            <TrendingUp className="w-3.5 h-3.5 text-gray-600" />
          </div>
        </div>
        <p className="text-lg font-bold tracking-tight text-gray-600">No data</p>
        <p className="text-xs text-gray-600">No closed trades yet</p>
      </div>
    )
  }

  // Sort: most recent / most activity first
  const sorted = [...tradedMarkets].sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl))

  return (
    <div className="card flex flex-col gap-2 min-w-0 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">P&L by Market</span>
        <a href="/dashboard/performance" className="text-[10px] text-brand-500 hover:text-brand-400 transition-colors flex items-center gap-0.5">
          Details <ArrowUpRight className="w-2.5 h-2.5" />
        </a>
      </div>

      <div className="space-y-2">
        {sorted.map(m => {
          const info = MARKET_PNL_INFO[m.market] ?? { emoji: '📊', label: m.market, currency: 'USDT' as MarketCurrency }
          const pnlPositive = m.pnl >= 0
          return (
            <div key={m.market} className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-xs">{info.emoji}</span>
                <span className="text-xs text-gray-400">{info.label}</span>
                <span className="text-[10px] text-gray-600">{m.closed}T</span>
              </div>
              <span className={`text-xs font-semibold font-mono ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPnlAmount(m.pnl, info.currency)}
              </span>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-gray-600 mt-auto">Closed trades · correct currencies</p>
    </div>
  )
}

// ── Bot status card ───────────────────────────────────────────────────────────
function BotStatusCard({
  status,
  activeMarkets,
  openTradeCount,
}: {
  status: string
  activeMarkets: string[]
  openTradeCount: number
}) {
  const isRunning  = status === 'running'
  const isStopping = status === 'stopping'
  const isError    = status === 'error'

  const dotColor = isRunning  ? 'bg-brand-500 animate-pulse' :
                   isStopping ? 'bg-amber-400 animate-pulse' :
                   isError    ? 'bg-red-500' : 'bg-gray-600'

  return (
    <div className="card flex flex-col gap-2 min-w-0 hover:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">Bot Status</span>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center bg-gray-800`}>
          <Layers className="w-3.5 h-3.5 text-gray-500" />
        </span>
      </div>
      <div>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />
          <p className={`text-2xl font-bold tracking-tight capitalize ${
            isRunning ? 'text-brand-500' : isError ? 'text-red-400' : 'text-gray-400'
          }`}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </p>
        </div>
        <p className="text-xs text-gray-600 mt-0.5">
          {activeMarkets.length > 0
            ? activeMarkets.join(' · ')
            : 'No active markets'}
        </p>
        {openTradeCount > 0 && (
          <p className="text-xs text-amber-400 mt-0.5">{openTradeCount} open position{openTradeCount !== 1 ? 's' : ''}</p>
        )}
      </div>
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: summaryData } = useQuery({
    queryKey: QUERY_KEYS.TRADES_SUMMARY,
    queryFn:  () => apiFetch<TradesSummaryResponse>('/api/trades/summary'),
    refetchInterval: 15_000,
  })

  // Combined performance query: cumPnl for chart + byMarket for the P&L card
  const { data: perfData, isLoading: perfLoading } = useQuery<PerformanceResponse>({
    queryKey: QUERY_KEYS.PERFORMANCE(),
    queryFn:  () => apiFetch<PerformanceResponse>('/api/performance'),
    staleTime: 60_000,
    refetchInterval: 60_000,
  })

  const { data: tradesData } = useQuery({
    queryKey: QUERY_KEYS.TRADES(),
    queryFn:  () => apiFetch<TradesResponse>('/api/trades?limit=50'),
  })

  const { data: botData, isLoading: botLoading } = useBotStatusQuery()

  const { data: strategyConfigData } = useQuery({
    queryKey: QUERY_KEYS.STRATEGY_CONFIGS,
    queryFn:  () => apiFetch<StrategyConfigListResponse>('/api/strategy-config'),
    select: (d) => {
      const markets = d?.markets ?? []
      const aggressiveMarkets = (markets ?? []).filter((m: any) => m.executionMode === 'AGGRESSIVE').map((m: any) => m.marketType)
      return { ...d, aggressiveMarkets }
    },
    staleTime: POLL_INTERVALS.STRATEGY,
  })

  const summary        = summaryData ?? { totalPnl: 0, totalFees: 0, winRate: 0, total: 0, closed: 0 }
  const recentTrades   = tradesData?.trades?.slice(0, 10) ?? []
  const cumPnlData     = perfData?.cumPnl ?? []
  const byMarket       = perfData?.byMarket ?? []

  const botStatus        = botData?.status ?? 'stopped'
  const botActiveMarkets = botData?.activeMarkets ?? []
  const openTradeCount   = botData?.openTradeCount ?? 0

  const aggressiveMarkets = strategyConfigData?.aggressiveMarkets ?? []
  const winPositive = summary.winRate >= 50

  return (
    <div className="flex flex-col gap-5 max-w-[1400px] mx-auto">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100 tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long', day: 'numeric', month: 'long'
            })}
          </p>
        </div>
        {aggressiveMarkets.length > 0 && (
          <div className="flex items-center gap-2 bg-red-950/30 border border-red-900/35 rounded-xl px-3 py-1.5 text-xs text-red-300">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse flex-shrink-0" />
            AGGRESSIVE: {aggressiveMarkets.join(', ')}
          </div>
        )}
      </div>

      {/* ── Top row: 4 stat cards ───────────────────────────────────────────── */}
      {/*
        Card 1: P&L by Market — shows each market's P&L in its own currency
                (crypto in USDT, Indian/Commod. in INR, Global in USD)
                Replaces the confusing single mixed-currency NET P&L card.
        Card 2: Win Rate
        Card 3: Total Trades
        Card 4: Bot Status
      */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <PnLByMarketCard byMarket={byMarket} isLoading={perfLoading && !perfData} />

        <StatCard
          label="Win Rate"
          value={`${summary.winRate.toFixed(1)}%`}
          sub={`${summary.closed} closed trades`}
          color={winPositive ? 'text-emerald-400' : 'text-red-400'}
          icon={Activity}
        />

        <StatCard
          label="Total Trades"
          value={summary.total.toLocaleString()}
          sub="Since inception"
          color="text-gray-200"
          icon={BarChart3}
        />

        {botLoading && !botData ? (
          <div className="card flex flex-col gap-2">
            <div className="h-3 w-20 bg-gray-800 rounded animate-pulse" />
            <div className="h-7 w-24 bg-gray-800 rounded animate-pulse mt-1" />
            <div className="h-3 w-28 bg-gray-800 rounded animate-pulse" />
          </div>
        ) : (
          <BotStatusCard
            status={botStatus}
            activeMarkets={botActiveMarkets}
            openTradeCount={openTradeCount}
          />
        )}
      </div>

      {/* ── Main section: chart (2/3) + bot controls (1/3) ─────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">

        {/* P&L Chart — 2/3 width */}
        <div className="xl:col-span-2 card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-200">Cumulative P&L</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                All time · <a href="/dashboard/performance" className="text-brand-500 hover:text-brand-400 transition-colors">view by market →</a>
              </p>
            </div>
          </div>

          <div className="h-[220px] sm:h-[260px]">
            <PnlChart cumPnlData={cumPnlData} />
          </div>
        </div>

        {/* Bot Controls — 1/3 width */}
        <div className="xl:col-span-1 flex flex-col">
          <BotControls />
        </div>
      </div>

      {/* ── Recent trades table ─────────────────────────────────────────────── */}
      <div className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-200">Recent Trades</h2>
            <p className="text-xs text-gray-500 mt-0.5">Last 10 executions</p>
          </div>
          <a
            href="/dashboard/trades"
            className="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-400 transition-colors font-medium"
          >
            View all
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        </div>
        <TradeTable trades={recentTrades as Trade[]} compact />
      </div>

    </div>
  )
}