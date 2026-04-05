'use client'

import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Power, ShieldAlert, Square, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineAlert } from '@/components/ui/inline-alert'
import { StatusBadge } from '@/components/ui/status-badge'
import { useToastStore } from '@/lib/toast-store'
import { cn } from '@/lib/utils'

const MARKETS = [
  { id: 'crypto', label: 'Crypto', shortLabel: 'Crypto' },
  { id: 'indian', label: 'Indian', shortLabel: 'Indian' },
  { id: 'global', label: 'Forex', shortLabel: 'Forex' },
  { id: 'commodities', label: 'Commodities', shortLabel: 'Commodities' },
] as const

type MarketId = typeof MARKETS[number]['id']

type SessionItem = {
  market: MarketId
  status: 'running' | 'stopped' | 'error'
  mode?: 'paper' | 'live' | null
  openTrades?: number
}

async function safeJson(res: Response): Promise<any> {
  try { return await res.json() } catch { return {} }
}

function StopModal({
  openTradeCount,
  hasLiveMarkets,
  onCloseAll,
  onGraceful,
  onClose,
}: {
  openTradeCount: number
  hasLiveMarkets: boolean
  onCloseAll: () => void
  onGraceful: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(4px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose() }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-gray-100">Stop all active sessions</p>
            <p className="mt-1 text-xs text-gray-500">{openTradeCount} open trade{openTradeCount === 1 ? '' : 's'} still need protection</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-gray-500 transition hover:bg-gray-800 hover:text-gray-200">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {hasLiveMarkets ? (
            <InlineAlert tone="danger" title="Live positions are exposed if monitoring stops.">
              Stopping the bot removes automated SL/TP supervision for live positions until you restart or close them manually.
            </InlineAlert>
          ) : null}

          <button
            type="button"
            onClick={onCloseAll}
            className="w-full rounded-2xl border border-red-500/25 bg-red-500/10 px-4 py-4 text-left transition hover:bg-red-500/15"
          >
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

          <button
            type="button"
            onClick={onGraceful}
            className="w-full rounded-2xl border border-brand-500/25 bg-brand-500/10 px-4 py-4 text-left transition hover:bg-brand-500/15"
          >
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

function ConflictModal({
  market,
  warnings,
  onCancel,
  onConfirm,
}: {
  market: string
  warnings: string[]
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.88)', backdropFilter: 'blur(4px)' }}
      onClick={(event) => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div className="w-full max-w-lg rounded-3xl border border-amber-500/20 bg-gray-950 shadow-2xl">
        <div className="border-b border-amber-500/15 px-5 py-4">
          <p className="text-sm font-semibold text-amber-200">Potential strategy conflict</p>
          <p className="mt-1 text-xs text-gray-400">Starting {market} may create opposing signals or capital contention.</p>
        </div>
        <div className="space-y-3 px-5 py-5">
          <InlineAlert tone="warning" title="Review before enabling this market.">
            Override is available, but the bot may block lower-priority strategies when capital is tight.
          </InlineAlert>
          <div className="space-y-2 rounded-2xl border border-gray-800 bg-gray-900/60 p-3">
            {warnings.map((warning) => (
              <p key={warning} className="text-xs leading-relaxed text-gray-300">{warning}</p>
            ))}
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
            <Button className="flex-1" onClick={onConfirm}>Override and start</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function BotControls({ botData }: { botData: any }) {
  const qc = useQueryClient()
  const pushToast = useToastStore((state) => state.push)
  const isFiringRef = useRef(false)
  const [showStopModal, setShowStopModal] = useState(false)
  const [conflictState, setConflictState] = useState<{ market: MarketId; warnings: string[] } | null>(null)

  const { data: modeData } = useQuery({
    queryKey: ['market-modes'],
    queryFn: () => fetch('/api/mode').then((response) => response.json()),
    staleTime: 30_000,
  })

  const { data: strategyConfigData } = useQuery({
    queryKey: ['strategy-configs'],
    queryFn: () => fetch('/api/strategy-config').then((response) => response.json()),
    staleTime: 30_000,
  })

  const status: string = botData?.status ?? 'stopped'
  const openTradeCount: number = botData?.openTradeCount ?? 0
  const sessions: SessionItem[] = botData?.sessions ?? []
  const activeMarkets: MarketId[] = botData?.activeMarkets ?? []
  const botErrorMessage: string | null = botData?.errorMessage ?? null
  const isStopping = status === 'stopping'
  const hasLiveMarkets = (modeData?.markets ?? []).some(
    (market: any) => market.mode === 'live' && activeMarkets.includes(market.marketType),
  )

  const sessionByMarket = useMemo(
    () => new Map(sessions.map((session) => [session.market, session])),
    [sessions],
  )

  const configByMarket = useMemo(
    () => new Map((strategyConfigData?.markets ?? []).map((market: any) => [market.marketType, market])),
    [strategyConfigData],
  )

  const syncMutation = useMutation({
    mutationFn: async ({ markets, conflictOverrides = [] }: { markets: MarketId[]; conflictOverrides?: MarketId[] }) => {
      const response = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markets, conflictOverrides }),
      })
      const data = await safeJson(response)
      if (!response.ok) throw new Error(data.error ?? `Failed to sync bot (HTTP ${response.status})`)
      return data
    },
    onMutate: async ({ markets }) => {
      await qc.cancelQueries({ queryKey: ['bot-status'] })
      const previous = qc.getQueryData(['bot-status'])
      qc.setQueryData(['bot-status'], (old: any) => ({
        ...old,
        status: 'running',
        activeMarkets: markets,
        sessions: MARKETS.map((market) => ({
          ...(sessionByMarket.get(market.id) ?? { market: market.id }),
          market: market.id,
          status: markets.includes(market.id) ? 'running' : 'stopped',
        })),
      }))
      return { previous }
    },
    onError: (error: Error, _variables, context) => {
      if (context?.previous) qc.setQueryData(['bot-status'], context.previous)
      pushToast({
        tone: 'error',
        title: 'Session update failed',
        description: error.message,
      })
    },
    onSuccess: (_data, variables) => {
      pushToast({
        tone: 'success',
        title: 'Market sessions updated',
        description: variables.markets.length
          ? `Running on ${variables.markets.join(', ')}.`
          : 'All sessions stopped.',
      })
    },
    onSettled: () => {
      isFiringRef.current = false
      qc.invalidateQueries({ queryKey: ['bot-status'] })
      qc.invalidateQueries({ queryKey: ['bot-history'] })
    },
  })

  const stopMutation = useMutation({
    mutationFn: async (mode: 'close_all' | 'graceful') => {
      const response = await fetch('/api/bot/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      const data = await safeJson(response)
      if (!response.ok) throw new Error(data.error ?? `Failed to stop bot (HTTP ${response.status})`)
      return data
    },
    onError: (error: Error) => {
      pushToast({
        tone: 'error',
        title: 'Stop request failed',
        description: error.message,
      })
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
    onSettled: () => {
      isFiringRef.current = false
      setShowStopModal(false)
      qc.invalidateQueries({ queryKey: ['bot-status'] })
      qc.invalidateQueries({ queryKey: ['bot-history'] })
    },
  })

  function marketWarnings(marketId: MarketId) {
    const config = configByMarket.get(marketId) as any
    return (config?.conflictWarnings ?? []).map((warning: any) => warning.message)
  }

  function handleToggle(marketId: MarketId, forceOverride = false) {
    if (isFiringRef.current || syncMutation.isPending || stopMutation.isPending || isStopping) return

    const currentlyActive = activeMarkets.includes(marketId)
    const nextMarkets = currentlyActive
      ? activeMarkets.filter((market) => market !== marketId)
      : [...activeMarkets, marketId]

    if (!currentlyActive) {
      const warnings = marketWarnings(marketId)
      if (warnings.length > 0 && !forceOverride) {
        setConflictState({ market: marketId, warnings })
        return
      }
    }

    isFiringRef.current = true
    if (nextMarkets.length === 0) {
      stopMutation.mutate('graceful')
      return
    }

    syncMutation.mutate({
      markets: nextMarkets,
      conflictOverrides: forceOverride ? [marketId] : [],
    })
  }

  return (
    <>
      {showStopModal ? (
        <StopModal
          openTradeCount={openTradeCount}
          hasLiveMarkets={hasLiveMarkets}
          onClose={() => setShowStopModal(false)}
          onCloseAll={() => stopMutation.mutate('close_all')}
          onGraceful={() => stopMutation.mutate('graceful')}
        />
      ) : null}

      {conflictState ? (
        <ConflictModal
          market={MARKETS.find((item) => item.id === conflictState.market)?.label ?? conflictState.market}
          warnings={conflictState.warnings}
          onCancel={() => setConflictState(null)}
          onConfirm={() => {
            const market = conflictState.market
            setConflictState(null)
            handleToggle(market, true)
          }}
        />
      ) : null}

      <div className="surface-panel w-full max-w-md p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Bot Status</p>
            <div className="mt-2 flex items-center gap-2">
              <StatusBadge tone={status === 'running' ? 'success' : status === 'stopping' ? 'warning' : status === 'error' ? 'danger' : 'neutral'}>
                {status.toUpperCase()}
              </StatusBadge>
              <span className="text-xs text-gray-500">{activeMarkets.length} active market{activeMarkets.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          <StatusBadge tone={hasLiveMarkets ? 'danger' : 'info'}>
            {hasLiveMarkets ? 'Live capital at risk' : 'Paper mode only'}
          </StatusBadge>
        </div>

        <div className="mt-4 space-y-2">
          {MARKETS.map((market) => {
            const session = sessionByMarket.get(market.id)
            const isActive = activeMarkets.includes(market.id)
            const config = configByMarket.get(market.id) as any
            const hasStrategies = (config?.strategyKeys ?? []).length > 0
            const warnings = marketWarnings(market.id)
            const disabled = syncMutation.isPending || stopMutation.isPending || isStopping || !hasStrategies
            return (
              <button
                key={market.id}
                type="button"
                disabled={disabled}
                onClick={() => handleToggle(market.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left transition',
                  isActive
                    ? 'border-brand-500/30 bg-brand-500/10'
                    : 'border-gray-800 bg-gray-950/60 hover:border-gray-700',
                  disabled ? 'cursor-not-allowed opacity-60' : '',
                )}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-100">{market.shortLabel}</span>
                    <StatusBadge tone={isActive ? 'success' : session?.status === 'error' ? 'danger' : 'neutral'}>
                      {isActive ? 'Running' : 'Stopped'}
                    </StatusBadge>
                    {session?.mode === 'live' ? <StatusBadge tone="danger">Live</StatusBadge> : null}
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    {hasStrategies
                      ? `${config?.strategyKeys?.length ?? 0} strategy slot${(config?.strategyKeys?.length ?? 0) === 1 ? '' : 's'} configured`
                      : 'No strategies selected'}
                    {warnings.length ? ` · ${warnings.length} conflict warning${warnings.length === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(syncMutation.isPending || stopMutation.isPending) && isActive ? (
                    <Loader2 className="h-4 w-4 animate-spin text-brand-400" />
                  ) : null}
                  <div className={cn('h-3 w-3 rounded-full', isActive ? 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]' : 'bg-gray-600')} />
                </div>
              </button>
            )
          })}
        </div>

        {botErrorMessage ? (
          <InlineAlert tone="danger" title="Bot error" className="mt-4">
            {botErrorMessage}
          </InlineAlert>
        ) : null}

        {!activeMarkets.length ? (
          <InlineAlert tone="info" title="No markets running" className="mt-4">
            Enable a market session to start scheduling only that market. The bot stays available without a full restart cycle.
          </InlineAlert>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-xs text-gray-500">
            {openTradeCount > 0 ? `${openTradeCount} open trade${openTradeCount === 1 ? '' : 's'} across active sessions` : 'No open trades'}
          </div>
          <Button
            variant="danger"
            className="min-w-[8.5rem]"
            disabled={stopMutation.isPending || syncMutation.isPending || (!activeMarkets.length && !openTradeCount)}
            onClick={() => setShowStopModal(true)}
          >
            {stopMutation.isPending ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Stopping…</>
            ) : (
              <><Square className="h-4 w-4" />Stop All</>
            )}
          </Button>
        </div>

        {isStopping ? (
          <div className="mt-3 flex items-center gap-2 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
            <Power className="h-3.5 w-3.5" />
            Graceful stop is in progress. Market toggles are temporarily locked.
          </div>
        ) : null}

        {(strategyConfigData?.markets ?? []).some((market: any) => market.executionMode === 'AGGRESSIVE') ? (
          <div className="mt-3 flex items-start gap-2 rounded-2xl border border-red-500/15 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
            At least one market is configured for AGGRESSIVE mode. Capital is managed per strategy and lower-priority entries can be blocked when exposure tightens.
          </div>
        ) : null}
      </div>
    </>
  )
}
