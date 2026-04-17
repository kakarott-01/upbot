'use client'

import { useCallback, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import useTrades from '@/lib/hooks/use-trades'
import { apiFetch } from '@/lib/api-client'
import { BOT_STATUS_QUERY_KEY, isValidBotSnapshot } from '@/lib/bot-status-client'
import { QUERY_KEYS } from '@/lib/query-keys'
import { useToastStore } from '@/lib/toast-store'
import { TradesView, type Pagination, type Trade } from '@/components/dashboard/trades/trades-view'
import { SectionErrorBoundary } from '@/components/ui/section-error-boundary'

const ConfirmModal = dynamic(() => import('@/components/modals/confirm-modal').then((module) => module.ConfirmModal), { ssr: false })

const MARKETS = ['all', 'indian', 'crypto', 'commodities', 'global']
const STATUSES = ['all', 'open', 'closed', 'failed', 'cancelled']
const MODES = ['all', 'paper', 'live'] as const

function exportCSV(trades: Trade[]) {
  const headers = ['Symbol', 'Side', 'Market', 'Exchange', 'Quantity', 'Entry', 'Amount Used', 'Exit', 'Fees', 'Net P&L', 'Status', 'Mode', 'Date']
  const rows = trades.map((trade) => [
    trade.symbol,
    trade.side,
    trade.marketType,
    trade.exchangeName,
    Number(trade.quantity).toFixed(4),
    Number(trade.entryPrice).toFixed(2),
    (Number(trade.quantity) * Number(trade.entryPrice)).toFixed(2),
    trade.exitPrice ? Number(trade.exitPrice).toFixed(2) : '',
    trade.feeAmount ? Number(trade.feeAmount).toFixed(2) : '',
    trade.netPnl ? Number(trade.netPnl).toFixed(2) : trade.pnl ? Number(trade.pnl).toFixed(2) : '',
    trade.status,
    trade.isPaper ? 'paper' : 'live',
    format(new Date(trade.openedAt), 'dd/MM/yyyy HH:mm'),
  ])
  const csv = [headers, ...rows].map((row) => row.join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `trades-${format(new Date(), 'yyyy-MM-dd')}.csv`
  anchor.click()
  URL.revokeObjectURL(url)
}

export default function TradesPage() {
  const qc = useQueryClient()
  const pushToast = useToastStore((state) => state.push)
  const [market, setMarket] = useState('all')
  const [status, setStatus] = useState('all')
  const [mode, setMode] = useState<(typeof MODES)[number]>('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<null | { type: string; label: string; message: string }>(null)
  const { data, isLoading, refetch, prefetchPage } = useTrades({ market, status, mode, page })

  const trades: Trade[] = useMemo(() => data?.trades ?? [], [data?.trades])
  const pagination: Pagination = useMemo(() => data?.pagination ?? { page: 1, limit: 50, total: 0, pages: 1, hasMore: false }, [data?.pagination])
  const summary = useMemo(() => data?.summary ?? { total: 0, closed: 0, totalPnl: 0, winRate: 0 }, [data?.summary])
  const showToast = useCallback((message: string, tone: 'success' | 'error' = 'success') => pushToast({ title: message, tone }), [pushToast])

  function queryKey() {
    return QUERY_KEYS.TRADES({ market, status, mode, page })
  }

  function applyFilter(update: () => void) {
    update()
    setPage(1)
    setSelected(new Set())
  }

  const deleteSingle = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/trades/${id}`, { method: 'DELETE' }),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      await qc.cancelQueries({ queryKey: queryKey() })
      const previousBot = qc.getQueryData(BOT_STATUS_QUERY_KEY)
      const previous = qc.getQueryData(queryKey() as any)
      qc.setQueryData(queryKey() as any, (old: any) => old?.trades ? { ...old, trades: old.trades.filter((trade: any) => trade.id !== id) } : old)
      return { previous, previousBot }
    },
    onError: (_error, _id, context: any) => {
      if (context?.previous) qc.setQueryData(queryKey() as any, context.previous)
      if (context?.previousBot && isValidBotSnapshot(context.previousBot)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previousBot)
      showToast('Failed to delete', 'error')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKey() })
      qc.invalidateQueries({ queryKey: QUERY_KEYS.TRADES_SUMMARY })
      qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
    },
  })

  const bulkDelete = useMutation({
    mutationFn: (payload: { type?: string; ids?: string[] }) =>
      apiFetch('/api/trades/bulk-delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onMutate: async (payload: { type?: string; ids?: string[] }) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      await qc.cancelQueries({ queryKey: queryKey() })
      const previousBot = qc.getQueryData(BOT_STATUS_QUERY_KEY)
      const previous = qc.getQueryData(queryKey() as any)
      if (payload.ids?.length) {
        qc.setQueryData(queryKey() as any, (old: any) => old?.trades ? { ...old, trades: old.trades.filter((trade: any) => !payload.ids!.includes(trade.id)) } : old)
      }
      return { previous, previousBot }
    },
    onError: (_error, _payload, context: any) => {
      if (context?.previous) qc.setQueryData(queryKey() as any, context.previous)
      if (context?.previousBot && isValidBotSnapshot(context.previousBot)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previousBot)
      showToast('Bulk delete failed', 'error')
      setConfirm(null)
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: queryKey() })
      qc.invalidateQueries({ queryKey: QUERY_KEYS.TRADES_SUMMARY })
      qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      setSelected(new Set())
      setConfirm(null)
    },
  })

  const allSelected = trades.length > 0 && selected.size === trades.length
  const isBusy = bulkDelete.isPending || deleteSingle.isPending
  const toggleAll = useCallback(() => setSelected((current) => (current.size === trades.length ? new Set() : new Set(trades.map((trade) => trade.id)))), [trades])
  const toggleOne = useCallback((id: string) => setSelected((current) => {
    const next = new Set(current)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  }), [])
  const deleteTrade = useCallback((id: string) => deleteSingle.mutate(id), [deleteSingle])

  function handleConfirmedDelete() {
    if (!confirm) return
    confirm.type === 'selected'
      ? bulkDelete.mutate({ type: 'selected', ids: Array.from(selected) })
      : bulkDelete.mutate({ type: confirm.type })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      {confirm && (
        <SectionErrorBoundary>
          <ConfirmModal
            title={confirm.label}
            message={confirm.message}
            onConfirm={handleConfirmedDelete}
            onClose={() => setConfirm(null)}
          />
        </SectionErrorBoundary>
      )}
      <TradesView
        market={market}
        status={status}
        mode={mode}
        markets={MARKETS}
        statuses={STATUSES}
        modes={MODES}
        summary={summary}
        trades={trades}
        selected={selected}
        allSelected={allSelected}
        isBusy={isBusy}
        isLoading={isLoading}
        pagination={pagination}
        onApplyFilter={applyFilter}
        setMarket={setMarket}
        setStatus={setStatus}
        setMode={setMode}
        setConfirm={setConfirm}
        setPage={setPage}
        setSelected={setSelected}
        onExport={() => exportCSV(trades)}
        onRefresh={() => refetch()}
        onToggleAll={toggleAll}
        onToggleOne={toggleOne}
        onDeleteTrade={deleteTrade}
        onPrefetchPage={prefetchPage}
      />
    </div>
  )
}
