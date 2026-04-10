'use client'

import { useState, type ElementType } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  AreaChart, Area, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Target, Activity,
  Award, AlertTriangle, BarChart2, Banknote, Wallet,
} from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { formatINR, formatPnl } from '@/lib/utils'

type DailyRow = {
  date: string
  pnl: number
  fees: number
  trades: number
  wins: number
  losses: number
}

type DailyData = {
  principle: number
  currentBalance: number
  totalPnl: number
  totalFees: number
  totalTrades: number
  todayPnl: number
  todayTrades: number
  daily: DailyRow[]
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value ?? 0
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPnl(Number(val))}
      </p>
    </div>
  )
}

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
  label,
  value,
  sub,
  color,
  icon: Icon,
}: {
  label: string
  value: string
  sub: string
  color: string
  icon: ElementType
}) {
  return (
    <div className="card flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">{label}</span>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-gray-800">
          <Icon className={`w-4 h-4 ${color}`} />
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

export default function PerformancePage() {
  const [mode, setMode] = useState<'all' | 'paper' | 'live'>('all')
  const [market, setMarket] = useState<'all' | 'indian' | 'crypto' | 'commodities' | 'global'>('all')

  const params = new URLSearchParams()
  if (mode !== 'all') params.set('mode', mode)
  if (market !== 'all') params.set('market', market)

  const { data, isLoading } = useQuery({
    queryKey: ['performance', mode, market],
    queryFn: () => fetch(`/api/performance?${params}`).then((r) => r.json()),
    staleTime: 30_000,
  })

  const { data: dailyData, isLoading: dailyLoading } = useQuery<DailyData>({
    queryKey: ['daily-pnl', mode, market],
    queryFn: () => fetch(`/api/daily-pnl?${params}`).then((r) => r.json()),
    staleTime: 30_000,
  })

  const s = data?.summary
  const daily = data?.dailyPnl ?? []
  const byMarket = data?.byMarket ?? []
  const cumPnl = data?.cumPnl ?? []

  const principle = dailyData?.principle ?? 0
  const currentBalance = dailyData?.currentBalance ?? 0
  const balanceChangePct = principle > 0 ? ((currentBalance - principle) / principle) * 100 : 0
  const dailyRows = dailyData?.daily ?? []
  const totalFees = dailyData?.totalFees ?? 0
  const totalTrades = dailyData?.totalTrades ?? 0
  const totalPnl = dailyData?.totalPnl ?? 0
  const isPositive = (cumPnl[cumPnl.length - 1]?.pnl ?? 0) >= 0

  const metrics = s ? [
    {
      label: 'Net P&L',
      value: formatPnl(s.totalPnl),
      sub: `${s.closed} closed trades`,
      color: s.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400',
      icon: s.totalPnl >= 0 ? TrendingUp : TrendingDown,
    },
    {
      label: 'Fees Paid',
      value: formatINR(s.totalFees),
      sub: 'Entry + exit costs',
      color: 'text-amber-400',
      icon: AlertTriangle,
    },
    {
      label: 'Win Rate',
      value: `${s.winRate.toFixed(1)}%`,
      sub: `${s.winners}W / ${s.losers}L`,
      color: s.winRate >= 50 ? 'text-emerald-400' : 'text-red-400',
      icon: Target,
    },
    {
      label: 'Risk : Reward',
      value: `1 : ${s.riskReward.toFixed(2)}`,
      sub: s.riskReward >= 1.5 ? 'Good ratio' : 'Below target',
      color: s.riskReward >= 1.5 ? 'text-emerald-400' : 'text-amber-400',
      icon: Activity,
    },
    {
      label: 'Avg Win',
      value: formatINR(s.avgWin),
      sub: `Best: ${formatINR(s.bestTrade)}`,
      color: 'text-emerald-400',
      icon: TrendingUp,
    },
    {
      label: 'Avg Loss',
      value: formatINR(Math.abs(s.avgLoss)),
      sub: `Worst: ${formatINR(Math.abs(s.worstTrade))}`,
      color: 'text-red-400',
      icon: TrendingDown,
    },
    {
      label: 'Total Trades',
      value: s.total,
      sub: `${s.open} open · ${s.closed} closed`,
      color: 'text-gray-200',
      icon: BarChart2,
    },
    {
      label: 'Paper Trades',
      value: s.paperCount,
      sub: 'Simulated',
      color: 'text-amber-400',
      icon: Award,
    },
    {
      label: 'Live Trades',
      value: s.liveCount,
      sub: 'Real money',
      color: s.liveCount > 0 ? 'text-red-400' : 'text-gray-500',
      icon: AlertTriangle,
    },
  ] : []

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <h1 className="text-xl font-semibold text-gray-100">Performance</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex gap-1.5">
            {(['all', 'paper', 'live'] as const).map((value) => (
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
            {(['all', 'indian', 'crypto', 'commodities', 'global'] as const).map((value) => (
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading
          ? Array.from({ length: 9 }).map((_, i) => <SkeletonCard key={i} />)
          : metrics.map((metric) => {
              const Icon = metric.icon
              return (
                <div key={metric.label} className="stat-card">
                  <div className="flex items-center justify-between mb-1">
                    <span className="stat-label">{metric.label}</span>
                    <Icon className="w-3.5 h-3.5 text-gray-700" />
                  </div>
                  <span className={`text-xl font-semibold ${metric.color}`}>{metric.value}</span>
                  <p className="stat-sub">{metric.sub}</p>
                </div>
              )
            })}
      </div>

      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Cumulative Net P&L</h2>
        {isLoading ? (
          <div className="h-44 bg-gray-800/40 rounded-lg animate-pulse" />
        ) : cumPnl.length === 0 ? (
          <div className="h-44 flex items-center justify-center text-sm text-gray-600">
            No closed trades yet - run the bot to see data
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={cumPnl} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cumGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0.15} />
                  <stop offset="95%" stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(value) => `₹${value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value}`}
                width={55}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Area
                type="monotone"
                dataKey="pnl"
                stroke={isPositive ? '#1D9E75' : '#E24B4A'}
                strokeWidth={2}
                fill="url(#cumGrad)"
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Daily P&L - Last 30 Days</h2>
        {isLoading ? (
          <div className="h-44 bg-gray-800/40 rounded-lg animate-pulse" />
        ) : daily.length === 0 ? (
          <p className="text-sm text-gray-600 text-center py-8">No closed trades yet</p>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={daily} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#6b7280' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false}
                tickLine={false}
                width={55}
                tickFormatter={(value) => `₹${value}`}
              />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {daily.map((row: any, index: number) => (
                  <Cell key={index} fill={row.pnl >= 0 ? '#1D9E75' : '#E24B4A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

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
            {['indian', 'crypto', 'commodities', 'global'].map((value) => {
              const marketRow = byMarket.find((row: any) => row.market === value)
              const pnl = marketRow?.pnl ?? 0
              const total = marketRow?.total ?? 0
              const closed = marketRow?.closed ?? 0
              const winners = marketRow?.winners ?? 0
              const wr = closed > 0 ? Math.round((winners / closed) * 100) : 0

              return (
                <div key={value} className="bg-gray-800/50 rounded-xl p-3 border border-gray-700/50">
                  <p className="text-xs text-gray-500 capitalize mb-1.5">{value}</p>
                  <p className={`text-lg font-semibold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {formatPnl(pnl).replace('.00', '')}
                  </p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {total} trades · {wr}% WR · Fees {formatINR(marketRow?.fees ?? 0).replace('.00', '')}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <h2 className="text-sm font-medium text-gray-300">Daily Balance</h2>
          <p className="mt-1 text-xs text-gray-500">
            Principle, current balance, and day-by-day outcomes for the selected market and mode.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <BalanceCard
            label="Principle Capital"
            value={formatINR(principle)}
            sub={dailyLoading ? 'Loading balance baseline...' : 'Starting capital for the current filter'}
            color="text-gray-200"
            icon={Banknote}
          />
          <BalanceCard
            label="Current Balance"
            value={formatINR(currentBalance)}
            sub={dailyLoading
              ? 'Loading current balance...'
              : `${balanceChangePct >= 0 ? '+' : ''}${balanceChangePct.toFixed(2)}% from principle · ${formatPnl(dailyData?.todayPnl ?? 0)} today`}
            color={currentBalance >= principle ? 'text-emerald-400' : 'text-red-400'}
            icon={Wallet}
          />
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
                {dailyLoading ? (
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
                          {formatPnl(row.pnl)}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-xs text-gray-500 font-mono">
                        {formatINR(row.fees)}
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

          {dailyRows.length > 0 && !dailyLoading && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900/40">
              <span className="text-xs text-gray-500">{dailyRows.length} trading days shown</span>
              <div className="flex items-center gap-6 text-xs">
                <span className="text-gray-600">
                  Total fees: <span className="text-gray-400 font-mono">{formatINR(totalFees)}</span>
                </span>
                <span className="text-gray-600">
                  Total trades: <span className="text-gray-400">{totalTrades}</span>
                </span>
                <span className={`font-semibold font-mono ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {formatPnl(totalPnl)}
                </span>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
