'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useBotStatusQuery } from '@/lib/use-bot-status-query'
import {
  AlertTriangle, Loader2, Power, ShieldAlert, Square,
  X, Zap, Play, Swords, Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { StatusBadge } from '@/components/ui/status-badge'
import { isValidBotSnapshot, type BotStatusSnapshot, BOT_STATUS_QUERY_KEY } from '@/lib/bot-status-client'
import { useToastStore } from '@/lib/toast-store'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api-client'

const MARKETS = [
  { id: 'crypto',      label: 'Crypto',       shortLabel: 'Crypto' },
  { id: 'indian',      label: 'Indian',        shortLabel: 'Indian' },
  { id: 'global',      label: 'Forex',         shortLabel: 'Forex' },
  { id: 'commodities', label: 'Commodities',   shortLabel: 'Commodities' },
] as const

type MarketId = typeof MARKETS[number]['id']

type SessionItem = {
  market:     MarketId
  status:     'running' | 'stopped' | 'error'
  mode?:      'paper' | 'live' | null
  openTrades?: number
}

type ModeDataResponse = {
  markets?: Array<{ marketType: MarketId; mode: 'paper' | 'live' }>
}

type StrategyConfigDataResponse = {
  markets?: Array<{
    marketType: MarketId
    strategyKeys?: string[]
    conflictWarnings?: Array<{ message: string }>
  }>
}

async function safeJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return {} }
}

// ── Stop ALL modal ────────────────────────────────────────────────────────────
function StopAllModal({
  openTradeCount,
  hasLiveMarkets,
  onCloseAll,
  onGraceful,
  onClose,
}: {
  openTradeCount:  number
  hasLiveMarkets:  boolean
  onCloseAll:      () => void
  onGraceful:      () => void
  onClose:         () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-100">Stop all active sessions</p>
            <p className="mt-1 text-xs text-gray-500">
              {openTradeCount} open trade{openTradeCount === 1 ? '' : 's'} still need protection
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 transition hover:bg-gray-800 hover:text-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {hasLiveMarkets && (
            <InlineAlert tone="danger" title="Live positions are exposed if monitoring stops.">
              Stopping the bot removes automated SL/TP supervision for live positions until you restart or close them manually.
            </InlineAlert>
          )}

          <button type="button" onClick={onCloseAll}
            className="w-full rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-4 text-left transition hover:bg-red-500/15">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-red-500/15 p-2">
                <Zap className="h-4 w-4 text-red-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-red-200">Close all positions and stop</p>
                <p className="mt-1 text-xs text-red-100/80">Use this when you need a hard stop right now.</p>
              </div>
            </div>
          </button>

          <button type="button" onClick={onGraceful}
            className="w-full rounded-2xl border border-brand-500/25 bg-brand-500/10 px-4 py-4 text-left transition hover:bg-brand-500/15">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-500/15 p-2">
                <ShieldAlert className="h-4 w-4 text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-300">Drain gracefully</p>
                <p className="mt-1 text-xs text-gray-300/80">No new entries. Existing trades remain monitored until they exit.</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Confirm start market modal ────────────────────────────────────────────────
function StartMarketModal({
  market,
  isLive,
  strategyKeys,
  warnings,
  onConfirm,
  onClose,
}: {
  market:       string
  isLive:       boolean
  strategyKeys: string[]
  warnings:     string[]
  onConfirm:    () => void
  onClose:      () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl overflow-hidden">
        <div className={cn(
          'flex items-center gap-3 px-5 py-4 border-b',
          isLive
            ? 'border-red-900/40 bg-red-950/20'
            : 'border-brand-500/20 bg-brand-500/5'
        )}>
          <div className={cn(
            'w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0',
            isLive ? 'bg-red-500/15' : 'bg-brand-500/15'
          )}>
            <Play className={cn('h-4 w-4', isLive ? 'text-red-400' : 'text-brand-400')} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-100">Start {market}</p>
            <p className={cn('text-xs mt-0.5', isLive ? 'text-red-400' : 'text-gray-500')}>
              {isLive ? '🔴 LIVE mode — real funds at risk' : '🟡 Paper mode — simulated trading'}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          {isLive && (
            <InlineAlert tone="danger" title="Real capital will be used">
              All signals for {market} will place real orders on the exchange. Losses are unrecoverable.
            </InlineAlert>
          )}

          {warnings.length > 0 && (
            <InlineAlert tone="warning" title="Potential strategy conflicts detected">
              <div className="space-y-1">
                {warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </div>
            </InlineAlert>
          )}

          {strategyKeys.length > 0 && (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/60 px-4 py-3 space-y-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Strategies to activate</p>
              {strategyKeys.map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full flex-shrink-0',
                    isLive ? 'bg-red-400' : 'bg-brand-500'
                  )} />
                  <span className="text-xs font-mono text-gray-300">{key}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={cn(
                'flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors',
                isLive
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-brand-500 hover:bg-brand-600'
              )}
            >
              {isLive ? 'Start Live Trading' : 'Start Market'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Per-market stop modal ─────────────────────────────────────────────────────
function MarketStopModal({
  market,
  isLive,
  openTradeCount,
  onDrain,
  onClose,
}: {
  market:         string
  isLive:         boolean
  openTradeCount: number
  onDrain:        () => void
  onClose:        () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-800">
          <div className="w-9 h-9 rounded-2xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
            <Square className="h-4 w-4 text-amber-400" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-100">Stop {market}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {openTradeCount === -1 ? (
                'Fetching latest positions...'
              ) : openTradeCount > 0 ? (
                `${openTradeCount} open position${openTradeCount !== 1 ? 's' : ''} · other markets continue running`
              ) : (
                'No open positions · other markets continue running'
              )}
            </p>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-3">
          {isLive && openTradeCount > 0 && (
            <InlineAlert tone="danger" title="Live positions need manual supervision if unmonitored.">
              After stopping, open positions won't have automated SL/TP until you restart or close them.
            </InlineAlert>
          )}

          <button type="button" onClick={onDrain}
            className="w-full rounded-2xl border border-brand-500/25 bg-brand-500/10 px-4 py-4 text-left transition hover:bg-brand-500/15 cursor-pointer">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-500/15 p-2">
                <Shield className="h-4 w-4 text-brand-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-brand-300">Drain &amp; stop</p>
                <p className="mt-1 text-xs text-gray-300/80">
                  Stop new entries for {market}. Existing positions close on their own exit signals.
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export function BotControls({ botData }: { botData: any }) {
  const qc        = useQueryClient()
  const pushToast = useToastStore((s) => s.push)

  // FIX: Use ref for firing state (no re-render on toggle) + Set for per-action locks
  const isFiringRef = useRef(false)
  // FIX: Use ref instead of state to avoid re-renders on lock/unlock
  const lockedActionsRef = useRef<Set<string>>(new Set())
  // Separate state only for triggering re-render when needed
  const [, forceUpdate] = useState(0)

  function lockAction(id: string) {
    lockedActionsRef.current.add(id)
    forceUpdate(n => n + 1)
  }

  function unlockAction(id: string) {
    lockedActionsRef.current.delete(id)
    forceUpdate(n => n + 1)
  }

  function isLocked(id: string) {
    return lockedActionsRef.current.has(id)
  }

  const { data: liveBotData, dataUpdatedAt } = useBotStatusQuery()

  const [showStopAllModal, setShowStopAllModal]   = useState(false)
  const [startModal, setStartModal]               = useState<{ market: MarketId } | null>(null)
  const [stopModal, setStopModal]                 = useState<{ market: MarketId; openTrades: number } | null>(null)

  const { data: modeData } = useQuery({
    queryKey: ['market-modes'],
    queryFn:  () => apiFetch<ModeDataResponse>('/api/mode'),
    staleTime: 30_000,
  })

  const { data: strategyConfigData } = useQuery({
    queryKey: ['strategy-configs'],
    queryFn:  () => apiFetch<StrategyConfigDataResponse>('/api/strategy-config'),
    staleTime: 30_000,
  })

  // FIX: Stable reference — prefer liveBotData, only fall back to botData prop once
  const dataSource = liveBotData ?? botData

  const status:         string    = dataSource?.status        ?? 'stopped'
  const openTradeCount: number    = dataSource?.openTradeCount ?? 0
  // FIX: Stable empty arrays — don't use ?? [] inline
  const sessions:       SessionItem[] = dataSource?.sessions  ?? []
  const activeMarkets:  MarketId[] = dataSource?.activeMarkets ?? []
  const botErrorMessage: string | null = dataSource?.errorMessage ?? null
  const isStopping = status === 'stopping'

  const perMarketOpenTrades: Record<string, number> = dataSource?.perMarketOpenTrades ?? {}

  const hasLiveMarkets = (modeData?.markets ?? []).some(
    (m: any) => m.mode === 'live' && activeMarkets.includes(m.marketType),
  )

  // FIX: Stable memo — sessions reference only changes when actual data changes
  const sessionByMarket = useMemo(
    () => new Map(sessions.map((s) => [s.market, s])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dataSource?.sessions],  // Depend on sessions from same source, not derived array
  )

  // FIX: Stable memo for configByMarket
  const strategyMarkets = strategyConfigData?.markets
  const configByMarket = useMemo(
    () => new Map((strategyMarkets ?? []).map((m: any) => [m.marketType, m])),
    [strategyMarkets],
  )

  // ── Mutations ───────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationKey: ['bot-start'],
    mutationFn: async ({ markets }: { markets: MarketId[] }) => {
      const res  = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error ?? `Failed to sync bot (HTTP ${res.status})`)
      return data
    },
    onMutate: async (vars: { markets: MarketId[] }) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)
      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = (old && isValidBotSnapshot(old)) ? old : previous ?? {
          status: 'running', stopMode: null, activeMarkets: [], started_at: null, stopped_at: null,
          stopping_at: null, last_heartbeat: null, errorMessage: null, openTradeCount: 0,
          perMarketOpenTrades: {}, timeoutWarning: false, sessions: [],
        }
        const nextActive = Array.from(new Set([...(base.activeMarkets ?? []), ...vars.markets]))
        return { ...base, status: 'running', activeMarkets: nextActive }
      })
      return { previous }
    },
    onError: (err: Error, vars, context: any) => {
      pushToast({ tone: 'error', title: 'Session update failed', description: err.message })
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous)
    },
    onSuccess: (_data, vars) => {
      pushToast({
        tone: 'success',
        title: 'Market sessions updated',
        description: vars.markets.length ? `Running on ${vars.markets.join(', ')}.` : 'All sessions stopped.',
      })
    },
    onSettled: async (_data, _err, vars: { markets: MarketId[] } | undefined) => {
      isFiringRef.current = false
      if (vars?.markets) {
        vars.markets.forEach((m) => unlockAction(`start-market:${m}`))
      }
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['bot-history'] })
    },
  })

  const stopAllMutation = useMutation({
    mutationFn: async (mode: 'close_all' | 'graceful') => {
      const res  = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error ?? `Failed to stop bot (HTTP ${res.status})`)
      return data
    },
    onMutate: async (mode: 'close_all' | 'graceful') => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)
      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = (old && isValidBotSnapshot(old)) ? old : previous ?? {
          status: 'stopping', stopMode: mode, activeMarkets: [], started_at: null, stopped_at: null,
          stopping_at: null, last_heartbeat: null, errorMessage: null, openTradeCount: 0,
          perMarketOpenTrades: {}, timeoutWarning: false, sessions: [],
        }
        return { ...base, status: 'stopping', stopMode: mode }
      })
      return { previous }
    },
    onError: (err: Error, vars, context: any) => {
      pushToast({ tone: 'error', title: 'Stop request failed', description: err.message })
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous)
    },
    onSuccess: (_data, mode) => {
      pushToast({
        tone: mode === 'close_all' ? 'warning' : 'success',
        title: mode === 'close_all' ? 'Emergency stop requested' : 'Graceful drain started',
        description: mode === 'close_all'
          ? 'The engine is closing all open positions and stopping.'
          : 'No new trades will open while active positions are drained.',
      })
    },
    onSettled: async (_data, _err, vars: 'close_all' | 'graceful' | undefined) => {
      isFiringRef.current = false
      setShowStopAllModal(false)
      if (vars) unlockAction(`stop-all:${vars}`)
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['bot-history'] })
    },
  })

  const stopMarketMutation = useMutation({
    mutationFn: async ({ marketType, mode }: { marketType: MarketId; mode: 'graceful' | 'close_all' }) => {
      const res  = await fetch('/api/bot/stop-market', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketType, mode }),
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data.error ?? `Failed to stop ${marketType}`)
      return data
    },
    onMutate: async (vars: { marketType: MarketId; mode: 'graceful' | 'close_all' }) => {
      await qc.cancelQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      const previous = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)
      qc.setQueryData<BotStatusSnapshot | undefined>(BOT_STATUS_QUERY_KEY, (old) => {
        const base = (old && isValidBotSnapshot(old)) ? old : previous ?? {
          status: 'running', stopMode: null, activeMarkets: [], started_at: null, stopped_at: null,
          stopping_at: null, last_heartbeat: null, errorMessage: null, openTradeCount: 0,
          perMarketOpenTrades: {}, timeoutWarning: false, sessions: [],
        }
        const nextActive = (base.activeMarkets ?? []).filter((m) => m !== vars.marketType)
        return { ...base, status: nextActive.length > 0 ? base.status : 'stopping', activeMarkets: nextActive }
      })
      return { previous }
    },
    onError: (err: Error, vars, context: any) => {
      pushToast({ tone: 'error', title: `Failed to stop ${vars.marketType}`, description: err.message })
      if (context?.previous && isValidBotSnapshot(context.previous)) qc.setQueryData(BOT_STATUS_QUERY_KEY, context.previous)
    },
    onSuccess: (data) => {
      const label = MARKETS.find((m) => m.id === data.stoppedMarket)?.label ?? data.stoppedMarket
      pushToast({
        tone: data.mode === 'close_all' ? 'warning' : 'success',
        title: data.mode === 'close_all' ? `${label} — closing positions` : `${label} drained`,
        description: data.mode === 'close_all'
          ? `Closing ${data.openPositionsClosed} position${data.openPositionsClosed !== 1 ? 's' : ''}.`
          : 'Market stopped, existing positions remain open.',
      })
    },
    onSettled: async (_data, _err, vars: { marketType: MarketId } | undefined) => {
      if (vars) unlockAction(`stop-market:${vars.marketType}`)
      setStopModal(null)
      isFiringRef.current = false
      await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
      qc.invalidateQueries({ queryKey: ['bot-history'] })
    },
  })

  const isStarting = syncMutation.isPending && status !== 'running'

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function marketWarnings(marketId: MarketId) {
    const cfg = configByMarket.get(marketId) as any
    return (cfg?.conflictWarnings ?? []).map((w: any) => w.message)
  }

  function isMarketLive(marketId: MarketId): boolean {
    const market = (modeData?.markets ?? []).find((m: any) => m.marketType === marketId)
    return market?.mode === 'live'
  }

  function marketStrategyKeys(marketId: MarketId): string[] {
    const cfg = configByMarket.get(marketId) as any
    return cfg?.strategyKeys ?? []
  }

  function marketOpenTrades(marketId: MarketId): number {
    return perMarketOpenTrades[marketId] ?? 0
  }

  // ── Click handler ────────────────────────────────────────────────────────────

  function handleMarketClick(marketId: MarketId) {
    if (isFiringRef.current || syncMutation.isPending || stopAllMutation.isPending || stopMarketMutation.isPending || isStopping) return

    const isActive = activeMarkets.includes(marketId)

    if (isActive) {
      // Show modal with current data immediately, then update with fresh data
      const currentTrades = marketOpenTrades(marketId)
      setStopModal({ market: marketId, openTrades: currentTrades })
      // Refresh in background to get latest count
      ;(async () => {
        await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
        const latest = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)
        const trades = latest?.perMarketOpenTrades?.[marketId] ?? currentTrades
        setStopModal((prev) => prev?.market === marketId ? { market: marketId, openTrades: trades } : prev)
      })()
    } else {
      setStartModal({ market: marketId })
    }
  }

  function confirmStart(marketId: MarketId) {
    const actionId = `start-market:${marketId}`
    if (isLocked(actionId)) return
    lockAction(actionId)
    isFiringRef.current = true
    const nextMarkets = [...activeMarkets, marketId]
    syncMutation.mutate({ markets: nextMarkets })
    setStartModal(null)
  }

  function confirmMarketStop(marketId: MarketId, mode: 'graceful' | 'close_all') {
    const actionId = `stop-market:${marketId}`
    if (isLocked(actionId)) return
    lockAction(actionId)
    isFiringRef.current = true
    stopMarketMutation.mutate({ marketType: marketId, mode })
  }

  function handleStopAll(mode: 'graceful' | 'close_all') {
    const actionId = `stop-all:${mode}`
    if (isLocked(actionId)) return
    lockAction(actionId)
    isFiringRef.current = true
    stopAllMutation.mutate(mode)
  }

  const ALL_MARKETS = MARKETS

  return (
    <>
      {startModal && (
        <StartMarketModal
          market={MARKETS.find((m) => m.id === startModal.market)?.label ?? startModal.market}
          isLive={isMarketLive(startModal.market)}
          strategyKeys={marketStrategyKeys(startModal.market)}
          warnings={marketWarnings(startModal.market)}
          onConfirm={() => confirmStart(startModal.market)}
          onClose={() => setStartModal(null)}
        />
      )}

      {stopModal && (
        <MarketStopModal
          market={MARKETS.find((m) => m.id === stopModal.market)?.label ?? stopModal.market}
          isLive={isMarketLive(stopModal.market)}
          openTradeCount={stopModal.openTrades}
          onDrain={() => confirmMarketStop(stopModal.market, 'graceful')}
          onClose={() => setStopModal(null)}
        />
      )}

      {showStopAllModal && (
        <StopAllModal
          openTradeCount={openTradeCount}
          hasLiveMarkets={hasLiveMarkets}
          onClose={() => setShowStopAllModal(false)}
          onCloseAll={() => handleStopAll('close_all')}
          onGraceful={() => handleStopAll('graceful')}
        />
      )}

      <div className="surface-panel w-full max-w-md p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Bot Status</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={
                isStarting            ? 'info'    :
                status === 'running'  ? 'success' :
                status === 'stopping' ? 'warning' :
                status === 'error'    ? 'danger'  : 'neutral'
              }>
                {isStarting ? 'STARTING' : status.toUpperCase()}
              </StatusBadge>
              <span className="text-xs text-gray-500">
                {activeMarkets.length} active market{activeMarkets.length === 1 ? '' : 's'}
              </span>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {dataUpdatedAt ? `Last updated: ${Math.max(0, Math.floor((Date.now() - dataUpdatedAt) / 1000))}s ago` : 'Last updated: —'}
            </div>
          </div>
          <StatusBadge tone={hasLiveMarkets ? 'danger' : 'info'}>
            {hasLiveMarkets ? 'Live capital at risk' : 'Paper mode only'}
          </StatusBadge>
        </div>

        <div className="mt-4 space-y-2">
          {ALL_MARKETS.map((market) => {
            const session    = sessionByMarket.get(market.id)
            const isActive   = activeMarkets.includes(market.id)
            const config     = configByMarket.get(market.id) as any
            const hasStrategies = (config?.strategyKeys ?? []).length > 0
            const warnings   = marketWarnings(market.id)
            const isLive     = isMarketLive(market.id)
            const openTrades = marketOpenTrades(market.id)

            const isThisMarketMutating = stopMarketMutation.isPending && stopMarketMutation.variables?.marketType === market.id
            const disabled = isStopping || !hasStrategies || stopAllMutation.isPending || isThisMarketMutating

            return (
              <button
                key={market.id}
                type="button"
                disabled={disabled}
                onClick={() => handleMarketClick(market.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition group',
                  isActive
                    ? isLive
                      ? 'border-red-500/30 bg-red-950/20 hover:bg-red-950/30'
                      : 'border-brand-500/30 bg-brand-500/10 hover:bg-brand-500/15'
                    : 'border-gray-800 bg-gray-950/60 hover:border-gray-700',
                  disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-100">{market.shortLabel}</span>

                    <StatusBadge tone={
                      isActive              ? (isLive ? 'danger' : 'success') :
                      session?.status === 'error' ? 'danger' : 'neutral'
                    }>
                      {isActive ? 'Running' : 'Stopped'}
                    </StatusBadge>

                    {isActive && isLive && (
                      <StatusBadge tone="danger">Live</StatusBadge>
                    )}

                    {isActive && openTrades > 0 && (
                      <span className="text-xs text-amber-400 bg-amber-900/20 border border-amber-800/30 px-1.5 py-0.5 rounded-full">
                        {openTrades} open
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {hasStrategies
                      ? `${config?.strategyKeys?.length ?? 0} strategy slot${(config?.strategyKeys?.length ?? 0) === 1 ? '' : 's'}`
                      : 'No strategies selected'}
                    {warnings.length > 0 ? ` · ${warnings.length} conflict${warnings.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>

                <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                  {isThisMarketMutating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
                  ) : null}

                  {!disabled && !isThisMarketMutating && (
                    <span className={cn(
                      'text-[10px] font-medium px-2 py-0.5 rounded-lg border opacity-0 group-hover:opacity-100 transition-opacity',
                      isActive
                        ? 'text-amber-400 bg-amber-900/20 border-amber-800/30'
                        : 'text-brand-400 bg-brand-500/10 border-brand-500/20'
                    )}>
                      {isActive ? 'Stop' : 'Start'}
                    </span>
                  )}

                  <div className={cn(
                    'h-3 w-3 rounded-full transition-all',
                    isActive
                      ? isLive
                        ? 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.6)]'
                        : 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]'
                      : 'bg-gray-600',
                    isActive && 'animate-pulse'
                  )} />
                </div>
              </button>
            )
          })}
        </div>

        {botErrorMessage && (
          <InlineAlert tone="danger" title="Bot error" className="mt-4">
            {botErrorMessage}
          </InlineAlert>
        )}

        {!activeMarkets.length && !isStopping && (
          <InlineAlert tone="info" title="No markets running" className="mt-4">
            Click any market to start it. Each market runs independently — you can start and stop them one at a time.
          </InlineAlert>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            {openTradeCount > 0
              ? `${openTradeCount} open trade${openTradeCount === 1 ? '' : 's'} across active sessions`
              : 'No open trades'}
          </div>
          <Button
            variant="danger"
            className="min-w-[8.5rem]"
            disabled={stopAllMutation.isPending || syncMutation.isPending || (!activeMarkets.length && !openTradeCount)}
            onClick={() => setShowStopAllModal(true)}
          >
            {stopAllMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Stopping…</>
            ) : (
              <><Square className="h-4 w-4" />Stop All</>
            )}
          </Button>
        </div>

        {isStopping && (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <Power className="h-3.5 w-3.5" />
            Graceful stop is in progress. Market toggles are temporarily locked.
          </div>
        )}

        {(strategyConfigData?.markets ?? []).some((m: any) => m.executionMode === 'AGGRESSIVE') && (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            At least one market is configured for AGGRESSIVE mode. Capital is managed per strategy and lower-priority entries can be blocked when exposure tightens.
          </div>
        )}
      </div>
    </>
  )
}