'use client'
import { useQuery } from '@tanstack/react-query'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { TrendingUp, TrendingDown, Target, Activity } from 'lucide-react'

export default function PerformancePage() {
  const { data } = useQuery({
    queryKey: ['trades-all'],
    queryFn:  () => fetch('/api/trades?limit=200').then(r => r.json()),
  })

  const trades  = data?.trades ?? []
  const closed  = trades.filter((t: any) => t.status === 'closed')
  const winners = closed.filter((t: any) => Number(t.pnl) > 0)
  const losers  = closed.filter((t: any) => Number(t.pnl) <= 0)

  const totalPnl    = closed.reduce((s: number, t: any) => s + Number(t.pnl ?? 0), 0)
  const avgWin      = winners.length ? winners.reduce((s: number, t: any) => s + Number(t.pnl), 0) / winners.length : 0
  const avgLoss     = losers.length  ? losers.reduce( (s: number, t: any) => s + Number(t.pnl), 0) / losers.length  : 0
  const winRate     = closed.length  ? (winners.length / closed.length) * 100 : 0
  const riskReward  = avgLoss !== 0  ? Math.abs(avgWin / avgLoss) : 0

  // P&L by market
  const byMarket = ['indian', 'crypto', 'commodities', 'global'].map(m => ({
    market: m,
    pnl:    closed.filter((t: any) => t.marketType === m)
                  .reduce((s: number, t: any) => s + Number(t.pnl ?? 0), 0),
    trades: closed.filter((t: any) => t.marketType === m).length,
  }))

  // Daily P&L bar chart data
  const dailyMap: Record<string, number> = {}
  closed.forEach((t: any) => {
    const day = t.closedAt?.slice(0, 10) ?? ''
    if (day) dailyMap[day] = (dailyMap[day] ?? 0) + Number(t.pnl ?? 0)
  })
  const dailyData = Object.entries(dailyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, pnl]) => ({ date: date.slice(5), pnl: Math.round(pnl * 100) / 100 }))

  const metrics = [
    { label: 'Total P&L',      value: `₹${totalPnl.toFixed(2)}`,    color: totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Win Rate',       value: `${winRate.toFixed(1)}%`,       color: winRate >= 50 ? 'text-emerald-400' : 'text-red-400' },
    { label: 'Avg Win',        value: `₹${avgWin.toFixed(2)}`,        color: 'text-emerald-400' },
    { label: 'Avg Loss',       value: `₹${Math.abs(avgLoss).toFixed(2)}`, color: 'text-red-400' },
    { label: 'Risk:Reward',    value: `1 : ${riskReward.toFixed(2)}`, color: riskReward >= 1.5 ? 'text-emerald-400' : 'text-amber-400' },
    { label: 'Total Trades',   value: closed.length,                  color: 'text-gray-200' },
  ]

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-100">Performance</h1>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="stat-card">
            <span className="stat-label">{m.label}</span>
            <span className={`text-xl font-semibold ${m.color}`}>{m.value}</span>
          </div>
        ))}
      </div>

      {/* Daily P&L bar chart */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Daily P&L — Last 30 Days</h2>
        {dailyData.length ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={dailyData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} width={55}
                tickFormatter={v => `₹${v}`} />
              <Tooltip
                contentStyle={{ background: '#111827', border: '1px solid #1f2937', borderRadius: 8, fontSize: 12 }}
                formatter={(v: any) => [`₹${v}`, 'P&L']}
              />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {dailyData.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? '#1D9E75' : '#E24B4A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-gray-600 text-center py-8">No closed trades yet</p>
        )}
      </div>

      {/* By market */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Performance by Market</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {byMarket.map(m => (
            <div key={m.market} className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-500 capitalize mb-1">{m.market}</p>
              <p className={`text-lg font-semibold ${m.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                ₹{m.pnl.toFixed(0)}
              </p>
              <p className="text-xs text-gray-600">{m.trades} trades</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}