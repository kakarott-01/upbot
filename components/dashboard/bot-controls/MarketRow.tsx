"use client"
import React from 'react'
import { Loader2 } from 'lucide-react'
import MarketButton from '@/components/dashboard/bot-controls/MarketButton'
import { StatusBadge } from '@/components/ui/status-badge'
import { cn } from '@/lib/utils'

type Market = { id: string; label: string; shortLabel: string }

type Props = {
  market: Market
  session?: any
  isActive: boolean
  config?: any
  warnings?: string[]
  isLive?: boolean
  openTrades?: number
  isThisMarketMutating?: boolean
  disabled?: boolean
  onClick?: () => void
}

function MarketRow({ market, session, isActive, config, warnings = [], isLive = false, openTrades = 0, isThisMarketMutating = false, disabled = false, onClick }: Props) {
  return (
    <MarketButton
      disabled={disabled}
      onClick={onClick}
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
            isActive ? (isLive ? 'danger' : 'success') :
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
          { (config?.strategyKeys?.length ?? 0) > 0
            ? `${config?.strategyKeys?.length ?? 0} strategy slot${(config?.strategyKeys?.length ?? 0) === 1 ? '' : 's'}`
            : 'No strategies selected'
          }
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
          isActive ? (isLive ? 'bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.6)]' : 'bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.6)]') : 'bg-gray-600',
          isActive && 'animate-pulse'
        )} />
      </div>
    </MarketButton>
  )
}

export default React.memo(MarketRow)
