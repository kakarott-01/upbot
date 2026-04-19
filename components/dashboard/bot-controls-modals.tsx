'use client'

import React, { forwardRef, useImperativeHandle, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useBotStatusQuery } from '@/lib/use-bot-status-query'
import { QUERY_KEYS } from '@/lib/query-keys'
import { apiFetch } from '@/lib/api-client'
import { BOT_STATUS_QUERY_KEY, type BotStatusSnapshot } from '@/lib/bot-status-client'
import { POLL_INTERVALS } from '@/lib/polling-config'
import { SectionErrorBoundary } from '@/components/ui/section-error-boundary'

const StopAllModal    = dynamic(() => import('@/components/modals/stop-all-modal'),    { ssr: false })
const StartMarketModal = dynamic(() => import('@/components/modals/start-market-modal'), { ssr: false })
const MarketStopModal  = dynamic(() => import('@/components/modals/market-stop-modal'), { ssr: false })

const MARKETS = [
  { id: 'crypto',      label: 'Crypto',       shortLabel: 'Crypto' },
  { id: 'indian',      label: 'Indian',        shortLabel: 'Indian' },
  { id: 'global',      label: 'Forex',         shortLabel: 'Forex' },
  { id: 'commodities', label: 'Commodities',   shortLabel: 'Commodities' },
] as const

type MarketId = typeof MARKETS[number]['id']

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

export type BotControlsModalsRef = {
  openStartModal:  (market: MarketId) => void
  openStopModal:   (market: MarketId) => void
  openStopAll:     () => void
  closeStopModal?: () => void
  closeAll?:       () => void
}

type Props = {
  confirmStart:      (market: MarketId) => void
  confirmMarketStop: (market: MarketId, mode: 'graceful' | 'close_all') => void
  handleStopAll:     (mode: 'graceful' | 'close_all') => void
}

export const BotControlsModals = forwardRef<BotControlsModalsRef, Props>(
  function BotControlsModals({ confirmStart, confirmMarketStop, handleStopAll }, ref) {
    const qc = useQueryClient()
    const { data: botData } = useBotStatusQuery({
      select: (data) => ({
        perMarketOpenTrades: data.perMarketOpenTrades,
        openTradeCount: data.openTradeCount,
        activeMarkets: data.activeMarkets,
      }),
    })

    const { data: modeData } = useQuery<ModeDataResponse>({
      queryKey: QUERY_KEYS.MARKET_MODES,
      queryFn:  () => apiFetch<ModeDataResponse>('/api/mode'),
      staleTime: POLL_INTERVALS.MARKET_MODES,
    })

    const { data: strategyConfigData } = useQuery<StrategyConfigDataResponse>({
      queryKey: QUERY_KEYS.STRATEGY_CONFIGS,
      queryFn:  () => apiFetch<StrategyConfigDataResponse>('/api/strategy-config'),
      select:   (d) => d,
      staleTime: POLL_INTERVALS.STRATEGY,
    })

    const [showStopAllModal, setShowStopAllModal] = useState(false)
    const [startModal, setStartModal] = useState<{ market: MarketId } | null>(null)
    const [stopModal,  setStopModal]  = useState<{ market: MarketId; openTrades: number } | null>(null)

    useImperativeHandle(ref, () => ({
      openStartModal(market) {
        setStartModal({ market })
      },
      openStopModal(market) {
        const currentTrades = botData?.perMarketOpenTrades?.[market] ?? 0
        setStopModal({ market, openTrades: currentTrades })
        // Refresh trade count in background
        ;(async () => {
          await qc.invalidateQueries({ queryKey: BOT_STATUS_QUERY_KEY })
          const latest = qc.getQueryData<BotStatusSnapshot>(BOT_STATUS_QUERY_KEY)
          const trades = latest?.perMarketOpenTrades?.[market] ?? currentTrades
          setStopModal((prev) => prev?.market === market ? { market, openTrades: trades } : prev)
        })()
      },
      openStopAll() {
        setShowStopAllModal(true)
      },
      closeStopModal() {
        setStopModal(null)
      },
      closeAll() {
        setShowStopAllModal(false)
      },
    }), [botData, qc])

    function isMarketLive(marketId: MarketId) {
      return (modeData?.markets ?? []).some((m: any) => m.marketType === marketId && m.mode === 'live')
    }

    function marketStrategyKeys(marketId: MarketId): string[] {
      const cfg = (strategyConfigData?.markets ?? []).find((m: any) => m.marketType === marketId) as any
      return cfg?.strategyKeys ?? []
    }

    function marketWarnings(marketId: MarketId) {
      const cfg = (strategyConfigData?.markets ?? []).find((m: any) => m.marketType === marketId) as any
      return (cfg?.conflictWarnings ?? []).map((w: any) => w.message)
    }

    return (
      <>
        {startModal && (
          <SectionErrorBoundary>
            <StartMarketModal
              market={MARKETS.find((m) => m.id === startModal.market)?.label ?? startModal.market}
              isLive={isMarketLive(startModal.market)}
              strategyKeys={marketStrategyKeys(startModal.market)}
              warnings={marketWarnings(startModal.market)}
              onConfirm={() => { confirmStart(startModal.market); setStartModal(null) }}
              onClose={() => setStartModal(null)}
            />
          </SectionErrorBoundary>
        )}

        {stopModal && (
          <SectionErrorBoundary>
            <MarketStopModal
              market={MARKETS.find((m) => m.id === stopModal.market)?.label ?? stopModal.market}
              isLive={isMarketLive(stopModal.market)}
              openTradeCount={stopModal.openTrades}
              onDrain={() => {
                confirmMarketStop(stopModal.market, 'graceful')
                setStopModal(null)
              }}
              onCloseAll={() => {
                confirmMarketStop(stopModal.market, 'close_all')
                setStopModal(null)
              }}
              onClose={() => setStopModal(null)}
            />
          </SectionErrorBoundary>
        )}

        {showStopAllModal && (
          <SectionErrorBoundary>
            <StopAllModal
              openTradeCount={botData?.openTradeCount ?? 0}
              hasLiveMarkets={(modeData?.markets ?? []).some(
                (m: any) => m.mode === 'live' && (botData?.activeMarkets ?? []).includes(m.marketType)
              )}
              onClose={() => setShowStopAllModal(false)}
              onCloseAll={() => { handleStopAll('close_all'); setShowStopAllModal(false) }}
              onGraceful={() => { handleStopAll('graceful'); setShowStopAllModal(false) }}
            />
          </SectionErrorBoundary>
        )}
      </>
    )
  }
)

export default BotControlsModals
