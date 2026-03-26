'use client'
import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Activity, DollarSign } from 'lucide-react'
import { PnlChart } from '@/components/charts/pnl-chart'
import { TradeTable } from '@/components/dashboard/trade-table'
import { BotControls } from '@/components/dashboard/bot-controls'
import { formatCurrency } from '@/lib/utils'

export default function DashboardPage() {
  const { data: tradesData } = useQuery({
    queryKey: ['trades'],
    queryFn:  () => fetch('/api/trades?limit=50').then(r => r.json()),
  })

  const { data: botData, isLoading: botLoading } = useQuery({
    queryKey:        ['bot-status'],
    queryFn:         () => fetch('/api/bot/status').then(r => r.json()),
    refetchInterval: 5000,
    // Never flash back to empty while re-fetching — carry previous value
    placeholderData: (prev) => prev,
  })

  const summary      = tradesData?.summary ?? { totalPnl: 0, winRate: 0, total: 0, closed: 0 }
  const recentTrades = tradesData?.trades?.slice(0, 10) ?? []

  // Bot status card values — show skeleton while the very first fetch is in flight
  const botStatus        = botData?.status ?? 'stopped'
  const botIsRunning     = botStatus === 'running'
  const botActiveMarkets = botData?.activeMarkets ?? []

  return (
    <div className="space-y-5 max-w-7xl mx-auto px-3 sm:px-4">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        {/* botData passed directly — BotControls reads the live query internally */}
        <BotControls botData={botData} />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">

        <div className="stat-card">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Total P&L</span>
            <DollarSign className="w-4 h-4 text-gray-700" />
          </div>
          <div className={`stat-value ${summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative'}`}>
            {formatCurrency(summary.totalPnl)}
          </div>
          <span className="stat-sub">All time</span>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Win Rate</span>
            <Activity className="w-4 h-4 text-gray-700" />
          </div>
          <div className={`stat-value ${summary.winRate >= 50 ? 'pnl-positive' : 'pnl-negative'}`}>
            {summary.winRate.toFixed(1)}%
          </div>
          <span className="stat-sub">{summary.closed} closed trades</span>
        </div>

        <div className="stat-card">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Total Trades</span>
            <TrendingUp className="w-4 h-4 text-gray-700" />
          </div>
          <div className="stat-value">{summary.total}</div>
          <span className="stat-sub">Since inception</span>
        </div>

        {/* Bot Status card — skeleton while loading, never flickers to stale state */}
        <div className="stat-card">
          <div className="flex items-center justify-between mb-1">
            <span className="stat-label">Bot Status</span>
            {botLoading && !botData ? (
              // First-load skeleton dot
              <span className="w-2 h-2 rounded-full bg-gray-700 animate-pulse" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${
                botIsRunning ? 'bg-brand-500 animate-pulse' : 'bg-gray-700'
              }`} />
            )}
          </div>

          {botLoading && !botData ? (
            // First-load skeleton text
            <>
              <div className="h-5 w-20 bg-gray-800 rounded animate-pulse mb-1" />
              <div className="h-3 w-28 bg-gray-800 rounded animate-pulse" />
            </>
          ) : (
            <>
              <div className={`stat-value text-base font-medium ${
                botIsRunning ? 'text-brand-500' : 'text-gray-500'
              }`}>
                {botIsRunning ? 'Running' : 'Stopped'}
              </div>
              <span className="stat-sub">
                {botActiveMarkets.length
                  ? botActiveMarkets.join(' · ')
                  : 'No active markets'}
              </span>
            </>
          )}
        </div>

      </div>

      {/* P&L Chart */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-300">P&L Over Time</h2>
          <span className="badge-gray">Last 30 days</span>
        </div>
        <PnlChart trades={tradesData?.trades ?? []} />
      </div>

      {/* Recent Trades */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-medium text-gray-300">Recent Trades</h2>
          <a href="/dashboard/trades" className="text-xs text-brand-500 hover:text-brand-600 transition-colors">
            View all →
          </a>
        </div>
        <TradeTable trades={recentTrades} compact />
      </div>

    </div>
  )
}