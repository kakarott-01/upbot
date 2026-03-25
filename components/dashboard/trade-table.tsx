'use client'
import { formatCurrency } from '@/lib/utils'
import { format } from 'date-fns'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

interface Props {
  trades: any[]
  compact?: boolean
}

export function TradeTable({ trades, compact }: Props) {
  if (!trades.length) {
    return (
      <div className="text-center py-8 text-sm text-gray-600">
        No trades yet. Start the bot to begin trading.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            {['Symbol', 'Side', 'Market', 'Entry', 'Exit', 'P&L', 'Status', 'Date'].map(h => (
              <th key={h} className="text-left text-xs text-gray-600 font-medium pb-2.5 px-2 first:pl-4 last:pr-4">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/50">
          {trades.map(trade => {
            const pnl = Number(trade.pnl ?? 0)
            const isProfit = pnl > 0
            return (
              <tr key={trade.id} className="hover:bg-gray-800/30 transition-colors group">
                <td className="py-2.5 px-2 pl-4 font-mono text-xs text-gray-300 font-medium">
                  {trade.symbol}
                  {trade.isPaper && <span className="ml-1.5 text-xs text-amber-600">[P]</span>}
                </td>
                <td className="py-2.5 px-2">
                  <div className={`flex items-center gap-1 text-xs font-medium ${
                    trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {trade.side === 'buy'
                      ? <ArrowUpRight className="w-3 h-3" />
                      : <ArrowDownRight className="w-3 h-3" />}
                    {trade.side.toUpperCase()}
                  </div>
                </td>
                <td className="py-2.5 px-2">
                  <span className="badge-gray capitalize">{trade.marketType}</span>
                </td>
                <td className="py-2.5 px-2 text-xs text-gray-400 font-mono">
                  ₹{Number(trade.entryPrice).toLocaleString('en-IN')}
                </td>
                <td className="py-2.5 px-2 text-xs text-gray-400 font-mono">
                  {trade.exitPrice ? `₹${Number(trade.exitPrice).toLocaleString('en-IN')}` : '—'}
                </td>
                <td className="py-2.5 px-2">
                  {trade.pnl != null ? (
                    <span className={`text-xs font-semibold font-mono ${isProfit ? 'text-emerald-400' : 'text-red-400'}`}>
                      {isProfit ? '+' : ''}₹{Math.abs(pnl).toFixed(2)}
                    </span>
                  ) : <span className="text-gray-600 text-xs">—</span>}
                </td>
                <td className="py-2.5 px-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${
                    trade.status === 'closed'    ? 'badge-gray' :
                    trade.status === 'open'      ? 'badge-blue' :
                    trade.status === 'failed'    ? 'badge-red'  :
                    trade.status === 'cancelled' ? 'badge-amber': 'badge-gray'
                  }`}>
                    {trade.status}
                  </span>
                </td>
                <td className="py-2.5 px-2 pr-4 text-xs text-gray-600">
                  {format(new Date(trade.openedAt), 'dd MMM HH:mm')}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}