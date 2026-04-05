'use client'

import { Layers3 } from 'lucide-react'
import { StrategySettings } from '@/components/dashboard/strategy-settings'

export default function StrategyEnginePage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-slate-900 to-gray-950 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-brand-500/20 bg-brand-500/10">
            <Layers3 className="h-5 w-5 text-brand-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-gray-100 sm:text-2xl">Strategy Engine</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-400">
              Configure sealed strategies per market, choose safe or aggressive execution, and keep the trading settings page focused on bot controls and risk.
            </p>
          </div>
        </div>
      </div>

      <StrategySettings />
    </div>
  )
}
