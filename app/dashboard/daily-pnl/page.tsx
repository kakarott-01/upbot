'use client'

import { useState } from 'react'
import { useQuery }  from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Wallet,
  Banknote, Filter, RefreshCw, CalendarDays,
} from 'lucide-react'
import { formatINR, formatPnl } from '@/lib/utils'
import { format, parseISO } from 'date-fns'

// ── Types ─────────────────────────────────────────────────────────────────────
interface DailyRow {
  date:   string
  pnl:    number
  fees:   number
  trades: number
  wins:   number
  losses: number
}

interface DailyData {
  principle:      number
  currentBalance: number
  totalPnl:       number
  totalFees:      number
  totalTrades:    number
  todayPnl:       number
  todayTrades:    number
  daily:          DailyRow[]
}

// ── Tooltip ───────────────────────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const row: DailyRow = payload[0]?.payload
  const val = row?.pnl ?? 0
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl px-3 py-2.5 text-xs shadow-xl space-y-1">
      <p className="text-gray-400 font-medium">{label}</p>
      <p className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        Net P&L: {formatPnl(val)}
      </p>
      <p className="text-gray-500">Fees: {formatINR(row?.fees ?? 0)}</p>
      <p className="text-gray-500">Trades: {row?.trades ?? 0} ({row?.wins ?? 0}W / {row?.losses ?? 0}L)</p>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function Card({
  label, value, sub, color, icon: Icon,
}: {
  label: string
  value: string
  sub: string
  color: string
  icon: React.ElementType
}) {
  return (
    <div className="card flex flex-col gap-2 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-widest">{label}</span>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center bg-gray-800`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
      </div>
      <p className={`text-2xl font-bold tracking-tight ${color}`}>{value}</p>
      <p className="text-xs text-gray-600">{sub}</p>
    </div>
  )
}

// ── Skeleton row ──────────────────────────────────────────────────────────────
function SkeletonRow() {
  return (
    <tr className="border-b border-gray-800/50">
      {[60, 80, 70, 40, 55].map((w, i) => (
        <td key={i} className="px-3 py-3">
          <div className={`h-3.5 bg-gray-800 rounded animate-pulse`} style={{ width: `${w}%` }} />
        </td>
      ))}
    </tr>
  )
}

// ── Win rate badge ────────────────────────────────────────────────────────────
function WrBadge({ wins, total }: { wins: number; total: number }) {
  if (!total) return <span className="text-gray-600 text-xs">—</span>
  const wr = Math.round((wins / total) * 100)
  return (
    <span className={`text-xs font-medium ${wr >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
      {wr}%
    </span>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DailyPnlPage() {
  const [market, setMarket] = useState('all')
  const [mode,   setMode]   = useState<'all' | 'paper' | 'live'>('all')

  const params = new URLSearchParams()
  if (market !== 'all') params.set('market', market)
  if (mode   !== 'all') params.set('mode',   mode)

  const { data, isLoading, refetch } = useQuery<DailyData>({
    queryKey: ['daily-pnl', market, mode],
    queryFn:  () => fetch(`/api/daily-pnl?${params}`).then(r => r.json()),
    staleTime: 30_000,
  })

  const principle      = data?.principle      ?? 0
  const currentBalance = data?.currentBalance ?? 0
  const totalPnl       = data?.totalPnl       ?? 0
  const totalFees      = data?.totalFees       ?? 0
  const totalTrades    = data?.totalTrades     ?? 0
  const todayPnl       = data?.todayPnl        ?? 0
  const todayTrades    = data?.todayTrades     ?? 0
  const daily          = data?.daily           ?? []

  // Balance change % from principle
  const balanceChangePct = principle > 0
    ? ((currentBalance - principle) / principle) * 100
    : 0
  const pnlPositive  = totalPnl >= 0
  const todayPositive = todayPnl >= 0

  // Chart data (chronological — oldest first for the chart)
  const chartData = [...daily]
    .slice(0, 30)
    .reverse()
    .map(r => ({
      ...r,
      label: format(parseISO(r.date), 'dd MMM'),
    }))

  const Pill = ({
    v, active, onClick,
  }: { v: string; active: boolean; onClick: () => void }) => (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
        active
          ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
          : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
      }`}
    >{v}</button>
  )

  return (
    <div className="space-y-5 max-w-5xl mx-auto">

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-brand-500" />
            Daily P&amp;L
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Day-by-day performance — {totalTrades} total closed trades
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Filters */}
      <div className="card space-y-3">
        <div className="flex items-center gap-2">
          <Filter className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs text-gray-500 font-medium uppercase tracking-wide">Filters</span>
        </div>
        <div className="flex flex-wrap gap-4">
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Market</p>
            <div className="flex gap-1.5 flex-wrap">
              {['all', 'indian', 'crypto', 'commodities', 'global'].map(m => (
                <Pill key={m} v={m} active={market === m} onClick={() => setMarket(m)} />
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Mode</p>
            <div className="flex gap-1.5">
              {(['all', 'paper', 'live'] as const).map(m => (
                <Pill key={m} v={m} active={mode === m} onClick={() => setMode(m)} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          label="Principle Capital"
          value={formatINR(principle)}
          sub={mode === 'live' ? 'Live starting capital' : 'Paper balance'}
          color="text-gray-200"
          icon={Banknote}
        />
        <Card
          label="Current Balance"
          value={formatINR(currentBalance)}
          sub={`${balanceChangePct >= 0 ? '+' : ''}${balanceChangePct.toFixed(2)}% from principle`}
          color={currentBalance >= principle ? 'text-emerald-400' : 'text-red-400'}
          icon={Wallet}
        />
        <Card
          label="All-time Net P&L"
          value={formatPnl(totalPnl)}
          sub={`Fees paid: ${formatINR(totalFees)}`}
          color={pnlPositive ? 'text-emerald-400' : 'text-red-400'}
          icon={pnlPositive ? TrendingUp : TrendingDown}
        />
        <Card
          label="Today's P&L"
          value={formatPnl(todayPnl)}
          sub={`${todayTrades} trade${todayTrades !== 1 ? 's' : ''} closed today`}
          color={todayPositive ? 'text-emerald-400' : 'text-red-400'}
          icon={todayPositive ? TrendingUp : TrendingDown}
        />
      </div>

      {/* Bar chart — last 30 days */}
      <div className="card">
        <h2 className="text-sm font-medium text-gray-400 mb-4">Daily P&amp;L — Last 30 Days</h2>
        {isLoading ? (
          <div className="h-48 bg-gray-800/40 rounded-xl animate-pulse" />
        ) : chartData.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-sm text-gray-600">
            No closed trades yet in this period
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false} tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#6b7280' }}
                axisLine={false} tickLine={false}
                tickFormatter={v => `₹${Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                width={56}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
              <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.pnl >= 0 ? '#1D9E75' : '#E24B4A'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="px-5 py-3.5 border-b border-gray-800">
          <h2 className="text-sm font-medium text-gray-300">Day-by-Day Breakdown</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                {['Date', 'Net P&L', 'Fees', 'Trades', 'Win Rate'].map(h => (
                  <th
                    key={h}
                    className="text-left text-xs text-gray-600 font-medium pb-3 pt-3.5 px-3 first:pl-5 last:pr-5 whitespace-nowrap"
                  >{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {isLoading
                ? Array.from({ length: 7 }).map((_, i) => <SkeletonRow key={i} />)
                : daily.length === 0
                ? (
                  <tr>
                    <td colSpan={5} className="text-center py-14 text-sm text-gray-600">
                      No closed trades found for the selected filters
                    </td>
                  </tr>
                )
                : daily.map(row => (
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
              }
            </tbody>
          </table>
        </div>

        {/* All-time totals footer */}
        {daily.length > 0 && !isLoading && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-800 bg-gray-900/40">
            <span className="text-xs text-gray-500">{daily.length} trading days shown</span>
            <div className="flex items-center gap-6 text-xs">
              <span className="text-gray-600">Total fees: <span className="text-gray-400 font-mono">{formatINR(totalFees)}</span></span>
              <span className="text-gray-600">Total trades: <span className="text-gray-400">{totalTrades}</span></span>
              <span className={`font-semibold font-mono ${pnlPositive ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatPnl(totalPnl)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}