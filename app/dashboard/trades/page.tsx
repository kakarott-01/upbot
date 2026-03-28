'use client'
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Filter, Trash2, CheckSquare, Square, AlertTriangle,
  X, ArrowUpRight, ArrowDownRight, RefreshCw, Download,
} from 'lucide-react'
import { format } from 'date-fns'

// ─── Types ────────────────────────────────────────────────────────────────────
interface Trade {
  id:          string
  symbol:      string
  side:        'buy' | 'sell'
  marketType:  string
  entryPrice:  string
  exitPrice:   string | null
  pnl:         string | null
  status:      string
  isPaper:     boolean
  openedAt:    string
  closedAt:    string | null
  exchangeName:string
}

const MARKETS  = ['all', 'indian', 'crypto', 'commodities', 'global']
const STATUSES = ['all', 'open', 'closed', 'failed', 'cancelled']

// ─── Toast ────────────────────────────────────────────────────────────────────
function useToast() {
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const show = useCallback((msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return { toast, show }
}

// ─── Confirm modal ────────────────────────────────────────────────────────────
function ConfirmModal({ title, message, confirmLabel = 'Delete', danger = true, onConfirm, onClose }: {
  title: string; message: string; confirmLabel?: string; danger?: boolean
  onConfirm: () => void; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`w-full max-w-sm bg-gray-900 border rounded-2xl shadow-2xl overflow-hidden ${danger ? 'border-red-900/40' : 'border-gray-700'}`}>
        <div className={`flex items-center gap-3 px-5 py-4 border-b ${danger ? 'border-red-900/30 bg-red-950/20' : 'border-gray-800'}`}>
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${danger ? 'bg-red-500/15' : 'bg-gray-800'}`}>
            <AlertTriangle className={`w-4 h-4 ${danger ? 'text-red-400' : 'text-amber-400'}`} />
          </div>
          <p className={`text-sm font-semibold ${danger ? 'text-red-300' : 'text-gray-100'}`}>{title}</p>
          <button onClick={onClose} className="ml-auto text-gray-600 hover:text-gray-300"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed">{message}</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors">Cancel</button>
            <button onClick={onConfirm} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-amber-600 hover:bg-amber-500'}`}>{confirmLabel}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Export CSV ───────────────────────────────────────────────────────────────
function exportCSV(trades: Trade[]) {
  const headers = ['Symbol', 'Side', 'Market', 'Exchange', 'Entry', 'Exit', 'P&L', 'Status', 'Mode', 'Date']
  const rows = trades.map(t => [
    t.symbol, t.side, t.marketType, t.exchangeName,
    Number(t.entryPrice).toFixed(2),
    t.exitPrice ? Number(t.exitPrice).toFixed(2) : '',
    t.pnl ? Number(t.pnl).toFixed(2) : '',
    t.status,
    t.isPaper ? 'paper' : 'live',
    format(new Date(t.openedAt), 'dd/MM/yyyy HH:mm'),
  ])
  const csv  = [headers, ...rows].map(r => r.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `trades-${format(new Date(), 'yyyy-MM-dd')}.csv`
  a.click(); URL.revokeObjectURL(url)
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function TradesPage() {
  const qc = useQueryClient()
  const { toast, show: showToast } = useToast()

  const [market,    setMarket]    = useState('all')
  const [status,    setStatus]    = useState('all')
  const [isPaper,   setIsPaper]   = useState<'all' | 'paper' | 'live'>('all')
  const [selected,  setSelected]  = useState<Set<string>>(new Set())
  const [confirm,   setConfirm]   = useState<null | { type: 'selected' | 'all' | 'paper' | 'live'; label: string; message: string }>(null)

  const params = new URLSearchParams({ limit: '200' })
  if (market !== 'all') params.set('market', market)
  if (status !== 'all') params.set('status', status)

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trades', market, status],
    queryFn:  () => fetch(`/api/trades?${params}`).then(r => r.json()),
  })

  const trades: Trade[] = (data?.trades ?? []).filter((t: Trade) => {
    if (isPaper === 'paper') return t.isPaper
    if (isPaper === 'live')  return !t.isPaper
    return true
  })

  // ── Delete single ──────────────────────────────────────────────────────────
  const deleteSingle = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/trades/${id}`, { method: 'DELETE' }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['trades-summary'] })
      showToast('Trade deleted')
      setSelected(prev => { const n = new Set(prev); return n })
    },
    onError: () => showToast('Failed to delete trade', 'error'),
  })

  // ── Bulk delete ────────────────────────────────────────────────────────────
  const bulkDelete = useMutation({
    mutationFn: (payload: { type?: string; ids?: string[] }) =>
      fetch('/api/trades/bulk-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['trades-summary'] })
      showToast(`${data.deleted} trade${data.deleted !== 1 ? 's' : ''} deleted`)
      setSelected(new Set())
      setConfirm(null)
    },
    onError: () => { showToast('Bulk delete failed', 'error'); setConfirm(null) },
  })

  // ── Selection helpers ──────────────────────────────────────────────────────
  const allSelected  = trades.length > 0 && selected.size === trades.length
  const someSelected = selected.size > 0

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else             setSelected(new Set(trades.map(t => t.id)))
  }

  function toggleOne(id: string) {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  function handleConfirmedDelete() {
    if (!confirm) return
    if (confirm.type === 'selected') {
      bulkDelete.mutate({ type: 'selected', ids: Array.from(selected) })
    } else {
      bulkDelete.mutate({ type: confirm.type })
    }
  }

  const isBusy = bulkDelete.isPending || deleteSingle.isPending

  return (
    <div className="space-y-4 max-w-6xl mx-auto">

      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border ${
          toast.type === 'success'
            ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
            : 'bg-red-900/20 border-red-800/30 text-red-400'
        }`}>
          {toast.type === 'success' ? '✓' : '✗'} {toast.msg}
        </div>
      )}

      {/* Confirm modal */}
      {confirm && (
        <ConfirmModal
          title={confirm.label}
          message={confirm.message}
          confirmLabel="Delete"
          onConfirm={handleConfirmedDelete}
          onClose={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Trade History</h1>
          <p className="text-sm text-gray-500 mt-0.5">{trades.length} trades shown</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => exportCSV(trades)} disabled={trades.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
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
                    market === m ? 'bg-brand-500/15 border-brand-500/30 text-brand-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>{m}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Status</p>
            <div className="flex gap-1.5 flex-wrap">
              {STATUSES.map(s => (
                <button key={s} onClick={() => setStatus(s)}
                  className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
                    status === s ? 'bg-brand-500/15 border-brand-500/30 text-brand-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>{s}</button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-gray-600 mb-1.5">Mode</p>
            <div className="flex gap-1.5">
              {(['all', 'paper', 'live'] as const).map(m => (
                <button key={m} onClick={() => setIsPaper(m)}
                  className={`px-3 py-1 text-xs rounded-lg border capitalize transition-colors ${
                    isPaper === m ? 'bg-brand-500/15 border-brand-500/30 text-brand-500' : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
                  }`}>{m}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Summary */}
      {data?.summary && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total P&L', value: `₹${Number(data.summary.totalPnl).toFixed(2)}`, color: data.summary.totalPnl >= 0 ? 'pnl-positive' : 'pnl-negative' },
            { label: 'Win Rate',  value: `${data.summary.winRate}%`, color: data.summary.winRate >= 50 ? 'pnl-positive' : 'pnl-negative' },
            { label: 'Trades',    value: data.summary.total, color: 'text-gray-200' },
          ].map(c => (
            <div key={c.label} className="stat-card">
              <span className="stat-label">{c.label}</span>
              <span className={`text-xl font-semibold ${c.color}`}>{c.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bulk action bar */}
      <div className="flex items-center justify-between flex-wrap gap-2 min-h-[36px]">
        <div className="flex items-center gap-2">
          {someSelected && (
            <span className="text-xs text-gray-400 bg-gray-800 border border-gray-700 px-2.5 py-1.5 rounded-lg">
              {selected.size} selected
            </span>
          )}
          {someSelected && (
            <button
              onClick={() => setConfirm({ type: 'selected', label: 'Delete Selected', message: `Delete ${selected.size} selected trade${selected.size !== 1 ? 's' : ''}? This cannot be undone.` })}
              disabled={isBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/20 hover:bg-red-900/30 border border-red-900/30 rounded-lg transition-colors disabled:opacity-40">
              <Trash2 className="w-3 h-3" /> Delete Selected
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setConfirm({ type: 'paper', label: 'Delete Paper Trades', message: 'Delete ALL paper trades? This cannot be undone.' })}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-400 bg-amber-900/15 hover:bg-amber-900/25 border border-amber-900/30 rounded-lg transition-colors disabled:opacity-40">
            <Trash2 className="w-3 h-3" /> Delete Paper
          </button>
          <button
            onClick={() => setConfirm({ type: 'live', label: 'Delete Live Trades', message: 'Delete ALL live trades? This cannot be undone.' })}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/15 hover:bg-red-900/25 border border-red-900/30 rounded-lg transition-colors disabled:opacity-40">
            <Trash2 className="w-3 h-3" /> Delete Live
          </button>
          <button
            onClick={() => setConfirm({ type: 'all', label: 'Delete All Trades', message: 'Delete EVERY trade in your account? This cannot be undone.' })}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 bg-red-900/20 hover:bg-red-900/30 border border-red-900/40 rounded-lg transition-colors disabled:opacity-40">
            <Trash2 className="w-3 h-3" /> Delete All
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800">
                <th className="w-10 py-3 pl-4">
                  <button onClick={toggleAll} className="text-gray-500 hover:text-brand-500 transition-colors">
                    {allSelected
                      ? <CheckSquare className="w-4 h-4 text-brand-500" />
                      : <Square className="w-4 h-4" />}
                  </button>
                </th>
                {['Symbol', 'Side', 'Market', 'Entry', 'Exit', 'P&L', 'Status', 'Mode', 'Date', ''].map(h => (
                  <th key={h} className="text-left text-xs text-gray-600 font-medium pb-3 pt-3 px-2 last:pr-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-800/50">
                    <td colSpan={11} className="px-4 py-3">
                      <div className="h-4 bg-gray-800 rounded animate-pulse w-full" />
                    </td>
                  </tr>
                ))
              ) : trades.length === 0 ? (
                <tr>
                  <td colSpan={11} className="text-center py-12 text-sm text-gray-600">
                    No trades match your filters
                  </td>
                </tr>
              ) : trades.map(trade => {
                const pnl      = Number(trade.pnl ?? 0)
                const isProfit = pnl > 0
                const isChecked = selected.has(trade.id)
                return (
                  <tr key={trade.id}
                    className={`hover:bg-gray-800/30 transition-colors group ${isChecked ? 'bg-brand-500/5' : ''}`}>
                    <td className="py-2.5 pl-4 w-10">
                      <button onClick={() => toggleOne(trade.id)} className="text-gray-600 hover:text-brand-500 transition-colors">
                        {isChecked
                          ? <CheckSquare className="w-4 h-4 text-brand-500" />
                          : <Square className="w-4 h-4" />}
                      </button>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-xs text-gray-300 font-medium">
                      {trade.symbol}
                      {trade.isPaper && <span className="ml-1.5 text-xs text-amber-600">[P]</span>}
                    </td>
                    <td className="py-2.5 px-2">
                      <div className={`flex items-center gap-1 text-xs font-medium ${
                        trade.side === 'buy' ? 'text-emerald-400' : 'text-red-400'
                      }`}>
                        {trade.side === 'buy' ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
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
                        trade.status === 'closed'  ? 'badge-gray' :
                        trade.status === 'open'    ? 'bg-brand-500/10 border-brand-500/20 text-brand-500' :
                        trade.status === 'failed'  ? 'bg-red-900/20 border-red-800/30 text-red-400' : 'badge-gray'
                      }`}>{trade.status}</span>
                    </td>
                    <td className="py-2.5 px-2">
                      {trade.isPaper
                        ? <span className="text-xs text-amber-500">Paper</span>
                        : <span className="text-xs text-red-400">Live</span>}
                    </td>
                    <td className="py-2.5 px-2 text-xs text-gray-600">
                      {format(new Date(trade.openedAt), 'dd MMM HH:mm')}
                    </td>
                    <td className="py-2.5 px-2 pr-4">
                      <button
                        onClick={() => deleteSingle.mutate(trade.id)}
                        disabled={isBusy}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg text-gray-600 hover:text-red-400 hover:bg-red-900/20 disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}