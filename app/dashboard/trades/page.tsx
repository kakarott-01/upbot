'use client'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { TradeTable } from '@/components/dashboard/trade-table'
import { Filter } from 'lucide-react'

const MARKETS  = ['all', 'indian', 'crypto', 'commodities', 'global']
const STATUSES = ['all', 'open', 'closed', 'failed', 'cancelled']

export default function TradesPage() {
  const [market, setMarket]   = useState('all')
  const [status, setStatus]   = useState('all')
  const [isPaper, setIsPaper] = useState<'all' | 'paper' | 'live'>('all')

  const params = new URLSearchParams({ limit: '200' })
  if (market !== 'all') params.set('market', market)
  if (status !== 'all') params.set('status', status)

  const { data, isLoading } = useQuery({
    queryKey: ['trades', market, status],
    queryFn:  () => fetch(`/api/trades?${params}`).then(r => r.json()),
  })

  const trades = (data?.trades ?? []).filter((t: any) => {
    if (isPaper === 'paper') return t.isPaper
    if (isPaper === 'live')  return !t.isPaper
    return true
  })

  return (
    <div className="space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-100">Trade History</h1>
        <span className="text-sm text-gray-500">{trades.length} trades</span>
      </div>

      {/* Filters */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Filters</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Market</p>
            <div className="flex gap-1.5 flex-wrap">
              {MARKETS.map(m => (
                <button key={m} onClick={() => setMarket(m)}
                  className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
                    market === m
                      ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Status</p>
            <div className="flex gap-1.5 flex-wrap">
              {STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
                    status === s
                      ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Mode</p>
            <div className="flex gap-1.5">
              {(['all', 'paper', 'live'] as const).map(m => (
                <button key={m} onClick={() => setIsPaper(m)}
                  className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
                    isPaper === m
                      ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                      : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {data?.summary && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total P&L',  value: `₹${Number(data.summary.totalPnl).toFixed(2)}`,  color: data.summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative' },
            { label: 'Win Rate',   value: `${data.summary.winRate}%`,   color: data.summary.winRate >= 50 ? 'pnl-positive' : 'pnl-negative' },
            { label: 'Trades',     value: data.summary.total,           color: 'text-gray-200' },
          ].map(c => (
            <div key={c.label} className="stat-card">
              <span className="stat-label">{c.label}</span>
              <span className={`text-xl font-semibold ${c.color}`}>{c.value}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        {isLoading
          ? <p className="text-sm text-gray-600 text-center py-8">Loading trades…</p>
          : <TradeTable trades={trades} />}
      </div>
    </div>
  )
}