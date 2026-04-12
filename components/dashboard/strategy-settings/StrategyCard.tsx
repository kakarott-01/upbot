"use client"
import React from 'react'
import { StatusBadge } from '@/components/ui/status-badge'

type MarketId = 'crypto' | 'indian' | 'global' | 'commodities'

type Props = {
  strategy: any
  selected: boolean
  disabled?: boolean
  marketId?: MarketId
  onToggle?: (marketId: MarketId, strategyKey: string) => void
}

function StrategyCard({ strategy, selected, disabled = false, marketId, onToggle }: Props) {
  return (
    <button
      key={strategy.strategyKey}
      type="button"
      disabled={disabled}
      onClick={() => marketId && onToggle?.(marketId, strategy.strategyKey)}
      className={`rounded-2xl border p-4 text-left transition ${selected ? 'border-brand-500/50 bg-brand-500/10' : 'border-gray-800 bg-gray-950/60 hover:border-gray-700'} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-gray-100">{strategy.name}</span>
        <StatusBadge tone={strategy.riskLevel === 'HIGH' ? 'danger' : strategy.riskLevel === 'MEDIUM' ? 'warning' : 'success'}>
          {strategy.riskLevel}
        </StatusBadge>
      </div>
      <p className="mt-2 text-xs text-gray-400">{strategy.description}</p>
      <div className="mt-3 grid gap-1 text-[11px] text-gray-500">
        <div>Win rate {strategy.historicalPerformance.winRate}%</div>
        <div>Average return {strategy.historicalPerformance.averageReturn}%</div>
        <div>Max drawdown {strategy.historicalPerformance.maxDrawdown}%</div>
      </div>
    </button>
  )
}

export default React.memo(StrategyCard)
