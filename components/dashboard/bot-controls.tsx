'use client'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play, Square, AlertTriangle } from 'lucide-react'

const MARKETS = [
  { id: 'indian',      label: '🇮🇳 Indian' },
  { id: 'crypto',      label: '₿ Crypto' },
  { id: 'commodities', label: '🛢 Commodities' },
  { id: 'global',      label: '🌐 Global' },
]

export function BotControls({ botData }: { botData: any }) {
  const qc               = useQueryClient()
  const [selectedMarkets, setSelected] = useState<string[]>(['crypto'])
  const isRunning        = botData?.status === 'running'
  const [showPaperWarning, setShowPaperWarning] = useState(false)

  const startMut = useMutation({
    mutationFn: () => fetch('/api/bot/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markets: selectedMarkets }),
    }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bot-status'] }),
  })

  const stopMut = useMutation({
    mutationFn: () => fetch('/api/bot/stop', { method: 'POST' }).then(r => r.json()),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['bot-status'] }),
  })

  function toggleMarket(id: string) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {/* Paper mode badge */}
      <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20 border border-amber-900/30 rounded-lg px-2.5 py-1">
        <AlertTriangle className="w-3 h-3" />
        Paper Mode Active — no real trades
      </div>

      {!isRunning && (
        <div className="flex flex-wrap gap-1.5 justify-end">
          {MARKETS.map(m => (
            <button
              key={m.id}
              onClick={() => toggleMarket(m.id)}
              className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                selectedMarkets.includes(m.id)
                  ? 'bg-brand-500/15 border-brand-500/30 text-brand-500'
                  : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {isRunning ? (
          <button
            onClick={() => stopMut.mutate()}
            disabled={stopMut.isPending}
            className="btn-danger"
          >
            <Square className="w-3.5 h-3.5" />
            Stop Bot
          </button>
        ) : (
          <button
            onClick={() => startMut.mutate()}
            disabled={startMut.isPending || selectedMarkets.length === 0}
            className="btn-primary"
          >
            {startMut.isPending
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Play className="w-3.5 h-3.5" />}
            Start Bot
          </button>
        )}
      </div>
    </div>
  )
}