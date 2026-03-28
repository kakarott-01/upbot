'use client'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, LineChart, Line, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Target, Activity,
  Award, AlertTriangle, BarChart2, Filter,
} from 'lucide-react'

// ─── Custom Tooltip ───────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {val >= 0 ? '+' : ''}₹{Number(val).toFixed(2)}
      </p>
    </div>
  )
}

// ─── Skeleton card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="stat-card">
      <div className="h-3 w-20 bg-gray-800 rounded animate-pulse mb-2" />
      <div className="h-6 w-28 bg-gray-800 rounded animate-pulse mb-1" />
      <div className="h-3 w-16 bg-gray-800 rounded animate-pulse" />
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const [mode,   setMode]   = useState<'all' | 'paper' | 'live'>('all')
  const [market, setMarket] = useState<'all' | 'indian' | 'crypto' | 'commodities' | 'global'>('all')

  const params = new URLSearchParams()
  if (mode   !== 'all') params.set('mode',   mode)
  if (market !== 'all') params.set('market', market)

  const { data, isLoading } = useQuery({
    queryKey: ['performance', mode, market],
    queryFn:  () => fetch(`/api/performance?${params}`).then(r => r.json()),
    staleTime: 30_000,
  })

  const s        = data?.summary
  const daily    = data?.dailyPnl   ?? []
  const byMarket = data?.byMarket   ?? []
  const cumPnl   = data?.cumPnl     ?? []

  const isPositive = (cumPnl[cumPnl.length - 1]?.pnl ?? 0) >= 0

  const metrics = s ? [
    {
      label: 'Total P&L',
      value: `₹${s.totalPnl.toFixed(2)}`,
      sub:   `${s.closed} closed trades`,
      color: s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon:  s.totalPnl >= 0 ? TrendingUp : TrendingDown,
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
      value: `₹${s.avgWin.toFixed(2)}`,
      sub:   `Best: ₹${s.bestTrade.toFixed(2)}`,
      color: 'text-emerald-400',
      icon:  TrendingUp,
    },
    {
      label: 'Avg Loss',
      value: `₹${Math.abs(s.avgLoss).toFixed(2)}`,
      sub:   `Worst: ₹${Math.abs(s.worstTrade).toFixed(2)}`,
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
  ] : []

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* Header + Filters */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-gray-100">Performance</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {/* Mode filter */}
          <div className="flex gap-1.5">
            {(['all', 'paper', 'live'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  mode === m ? 'bg-brand-500/15 border-brand-500/30 text-brand-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}>{m}</button>
            ))}
          </div>
          {/* Market filter */}
          <div className="flex gap-1.5">
            {(['all', 'indian', 'crypto', 'commodities', 'global'] as const).map(m => (
              <button key={m} onClick={() => setMarket(m)}
                className={`px-3 py-1.5 text-xs rounded-lg border capitalize transition-colors ${
                  market === m ? 'bg-brand-500/15 border-brand-500/30 text-brand-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                }`}>{m}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
          : metrics.map(m => {
              const Icon = m.icon
              return (
                <div key={m.label} className="stat-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">{m.label}</span>
                    <Icon className="w-3.5 h-3.5 text-gray-700" />
                  </div>
                  <span className={`text-xl font-semibold ${m.color}`}>{m.value}</span>
                  <p className="stat-sub">{m.sub}</p>
                </div>
              )
            })}
      </div>

      {/* Cumulative P&L curve */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Cumulative P&L</h2>
        {isLoading ? (
          <div className="h-44 bg-gray-800/40 rounded-lg animate-pulse" />
        ) : cumPnl.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-sm text-gray-600">
            No closed trades yet — run the bot to see data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={cumPnl} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                tickFormatter={v => `₹${v >= 1000 ? (v/1000).toFixed(1)+'k' : v}`} width={55} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="pnl" stroke={isPositive ? '#1D9E75' : '#E24B4A'}
                strokeWidth={2} fill="url(#cumGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Daily P&L bar chart */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Daily P&L — Last 30 Days</h2>
        {isLoading ? (
          <div className="h-44 bg-gray-800/40 rounded-lg animate-pulse" />
        ) : daily.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-8">No closed trades yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={daily} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false}
                width={55} tickFormatter={v => `₹${v}`} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {daily.map((d: any, i: number) => (
                  <Cell key={i} fill={d.pnl >= 0 ? '#1D9E75' : '#E24B4A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* By market */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Performance by Market</h2>
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-20 bg-gray-800/40 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {['indian', 'crypto', 'commodities', 'global'].map(m => {
              const mData = byMarket.find((b: any) => b.market === m)
              const pnl     = mData?.pnl    ?? 0
              const total   = mData?.total  ?? 0
              const closed  = mData?.closed ?? 0
              const winners = mData?.winners ?? 0
              const wr      = closed > 0 ? Math.round((winners / closed) * 100) : 0
              return (
                <div key={m} className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
                  <p className="text-xs text-gray-500 capitalize mb-1.5">{m}</p>
                  <p className={`text-lg font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ₹{pnl >= 0 ? '' : '-'}{Math.abs(pnl).toFixed(0)}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">{total} trades · {wr}% WR</p>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}