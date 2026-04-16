'use client'

// components/charts/pnl-chart.tsx — v3
// ========================================
// Fixed: tooltip and Y-axis now show the correct currency symbol
// based on the marketFilter prop instead of hardcoding ₹.
//
// When showing a mixed-market portfolio (no filter), the chart title
// shows a "mixed currencies" warning so the user knows the aggregate
// is not directly comparable.

import { useMemo } from 'react'
import {
  Tooltip, ResponsiveContainer, ReferenceLine,
  AreaChart, Area, XAxis, YAxis,
} from 'recharts'
import {
  getMarketCurrency,
  formatAmount,
  formatPnlAmount,
  isMixedCurrencySet,
  type MarketCurrency,
} from '@/lib/currency'

interface CumPnlPoint { date: string; pnl: number }
interface Trade       { status: string; pnl: any; closedAt: any; marketType?: string }

interface Props {
  cumPnlData?:   CumPnlPoint[]
  trades?:       Trade[]
  /** Pass the active market filter so we know which currency to display. */
  marketFilter?: string   // 'all' | 'indian' | 'crypto' | 'commodities' | 'global'
}

function PnlCustomTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload?.length) return null
  const val: number = payload[0]?.value ?? 0
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-xl">
      <p className="text-gray-500 mb-0.5">{label}</p>
      <p className={`font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {formatPnlAmount(val, currency)}
      </p>
    </div>
  )
}

function yTickFormatter(v: number, currency: MarketCurrency): string {
  const abs = Math.abs(v)
  let formatted: string
  if (abs >= 1_000_000) {
    formatted = `${(abs / 1_000_000).toFixed(1)}M`
  } else if (abs >= 1_000) {
    formatted = `${(abs / 1_000).toFixed(1)}k`
  } else {
    formatted = abs.toFixed(2)
  }

  const prefix = currency === 'INR' ? '₹' : '$'
  const suffix = currency === 'USDT' ? ' USDT' : ''
  return `${v < 0 ? '-' : ''}${prefix}${formatted}${suffix}`
}

export function PnlChart({ cumPnlData, trades, marketFilter = 'all' }: Props) {
  // Determine display currency
  const currency: MarketCurrency = useMemo(() => {
    if (marketFilter && marketFilter !== 'all') {
      return getMarketCurrency(marketFilter)
    }
    return 'INR' // fallback for mixed — see warning below
  }, [marketFilter])

  const isMixed = marketFilter === 'all' || !marketFilter

  // Build data series — prefer pre-computed cumPnlData, fall back to raw trades
  const data: CumPnlPoint[] = useMemo(() => {
    if (cumPnlData && cumPnlData.length > 0) return cumPnlData

    if (!trades || trades.length === 0) return []

    const closed = trades
      .filter((t) => t.status === 'closed' && t.pnl != null && t.closedAt != null)
      .sort((a, b) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime())

    let cumulative = 0
    return closed.map((t) => {
      cumulative += Number(t.pnl)
      return {
        date: new Date(t.closedAt).toLocaleDateString('en-IN', {
          day: '2-digit', month: 'short',
        }),
        pnl: Math.round(cumulative * 100) / 100,
      }
    })
  }, [cumPnlData, trades])

  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center text-sm text-gray-600">
        No closed trades yet — run the bot to see P&L data
      </div>
    )
  }

  const isPositive = (data[data.length - 1]?.pnl ?? 0) >= 0

  return (
    <div className="space-y-1">
      {isMixed && (
        <p className="text-[11px] text-amber-500/80">
          ⚠️ Mixed markets — crypto is USDT, Indian/Commodities is INR. Aggregate total is not directly comparable. Filter by market for accurate values.
        </p>
      )}
      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={data} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0.15} />
              <stop offset="95%" stopColor={isPositive ? '#1D9E75' : '#E24B4A'} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false} tickLine={false} interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#6b7280' }}
            axisLine={false} tickLine={false}
            tickFormatter={(v) => yTickFormatter(v, currency)}
            width={70}
          />
          <Tooltip content={<PnlCustomTooltip currency={currency} />} />
          <ReferenceLine y={0} stroke="#374151" strokeDasharray="3 3" />
          <Area
            type="monotone" dataKey="pnl"
            stroke={isPositive ? '#1D9E75' : '#E24B4A'}
            strokeWidth={2} fill="url(#pnlGradient)"
            dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}