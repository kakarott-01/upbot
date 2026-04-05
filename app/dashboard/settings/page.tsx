'use client'
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Shield, Save, AlertTriangle } from 'lucide-react'
import { ModeControls } from '@/components/dashboard/mode-controls'
import { ToggleSwitch } from '@/components/ui/toggle-switch'

const defaults = {
  maxPositionPct:  2,
  stopLossPct:     1.5,
  takeProfitPct:   3,
  maxDailyLossPct: 5,
  maxOpenTrades:   3,
  cooldownSeconds: 300,
  trailingStop:    false,
  paperBalance:    10000,
}

export default function SettingsPage() {
  const qc = useQueryClient()
  const [form, setForm] = useState(defaults)
  const [saved, setSaved] = useState(false)

  const { data } = useQuery({
    queryKey: ['risk-settings'],
    queryFn:  () => fetch('/api/risk-settings').then(r => r.json()),
  })

  useEffect(() => {
    if (data && Object.keys(data).length) {
      setForm({
        maxPositionPct:  Number(data.maxPositionPct  ?? defaults.maxPositionPct),
        stopLossPct:     Number(data.stopLossPct     ?? defaults.stopLossPct),
        takeProfitPct:   Number(data.takeProfitPct   ?? defaults.takeProfitPct),
        maxDailyLossPct: Number(data.maxDailyLossPct ?? defaults.maxDailyLossPct),
        maxOpenTrades:   Number(data.maxOpenTrades   ?? defaults.maxOpenTrades),
        cooldownSeconds: Number(data.cooldownSeconds ?? defaults.cooldownSeconds),
        trailingStop:    data.trailingStop ?? defaults.trailingStop,
        paperBalance:    Number(data.paperBalance ?? defaults.paperBalance),
      })
    }
  }, [data])

  const saveMut = useMutation({
    mutationFn: () => fetch('/api/risk-settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(form),
    }).then(r => r.json()),
    onSuccess: () => {
      setSaved(true)
      qc.invalidateQueries({ queryKey: ['risk-settings'] })
      setTimeout(() => setSaved(false), 2500)
    },
  })

  function set(key: string, val: any) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  const SliderField = ({ label, field, min, max, step = 0.5, suffix = '%', description }: any) => (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="text-sm text-gray-300">{label}</label>
        <span className="text-sm font-mono text-brand-500 font-medium">
          {form[field as keyof typeof form]}{suffix}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step}
        value={form[field as keyof typeof form] as number}
        onChange={e => set(field, Number(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                   [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-brand-500
                   [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
      />
      {description && <p className="text-xs text-gray-600 mt-1">{description}</p>}
    </div>
  )

  return (
    <div className="space-y-5 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold text-gray-100">Bot Settings</h1>

      {/* Trading Mode Controls */}
      <ModeControls />

      {/* Risk Manager */}
      <div className="card space-y-5">
        <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
          <Shield className="w-4 h-4 text-brand-500" />
          <h2 className="text-sm font-medium text-gray-200">Risk Management</h2>
        </div>

        <div className="bg-amber-900/15 border border-amber-900/30 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-amber-400/80">
            These limits are enforced on every trade. The bot will refuse to trade if any limit would be violated.
            Start conservative — you can always loosen them later.
          </p>
        </div>

        <SliderField
          label="Max Position Size"
          field="maxPositionPct"
          min={0.5} max={20} step={0.5}
          description="Maximum % of your balance to risk on a single trade"
        />
        <SliderField
          label="Stop Loss"
          field="stopLossPct"
          min={0.5} max={10} step={0.5}
          description="Auto-exit if trade moves this % against you"
        />
        <SliderField
          label="Take Profit"
          field="takeProfitPct"
          min={0.5} max={20} step={0.5}
          description="Auto-exit and lock in gains at this % profit"
        />
        <SliderField
          label="Max Daily Loss"
          field="maxDailyLossPct"
          min={1} max={20} step={1}
          description="Bot pauses for the day if total loss hits this %"
        />

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-300">Max Simultaneous Trades</label>
            <span className="text-sm font-mono text-brand-500 font-medium">{form.maxOpenTrades}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={form.maxOpenTrades}
            onChange={e => set('maxOpenTrades', Number(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                       [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-brand-500
                       [&::-webkit-slider-thumb]:rounded-full"
          />
          <p className="text-xs text-gray-600 mt-1">Maximum open positions at any time</p>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-300">Cooldown After Loss</label>
            <span className="text-sm font-mono text-brand-500 font-medium">
              {form.cooldownSeconds >= 60
                ? `${Math.round(form.cooldownSeconds / 60)}m`
                : `${form.cooldownSeconds}s`}
            </span>
          </div>
          <input
            type="range" min={0} max={3600} step={60}
            value={form.cooldownSeconds}
            onChange={e => set('cooldownSeconds', Number(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                       [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-brand-500
                       [&::-webkit-slider-thumb]:rounded-full"
          />
          <p className="text-xs text-gray-600 mt-1">Wait this long before next trade after a loss</p>
        </div>

        {/* Trailing Stop — fixed toggle */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-800">
          <div className="flex-1 min-w-0 mr-4">
            <p className="text-sm text-gray-300">Trailing Stop Loss</p>
            <p className="text-xs text-gray-600">Stop loss follows price as it moves in your favour</p>
          </div>
          <ToggleSwitch
            checked={form.trailingStop}
            onChange={v => set('trailingStop', v)}
          />
        </div>

        <div className="pt-2 border-t border-gray-800">
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm text-gray-300">Paper Trading Balance</label>
            <span className="text-sm font-mono text-brand-500 font-medium">
              ₹{form.paperBalance.toLocaleString('en-IN')}
            </span>
          </div>
          <input
            type="range" min={1000} max={1000000} step={1000}
            value={form.paperBalance}
            onChange={e => set('paperBalance', Number(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-full appearance-none cursor-pointer
                       [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4
                       [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-brand-500
                       [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer"
          />
          <p className="text-xs text-gray-600 mt-1">Simulated capital used for paper-mode position sizing</p>
        </div>

        <button
          onClick={() => saveMut.mutate()}
          disabled={saveMut.isPending}
          className="btn-primary w-full"
        >
          {saveMut.isPending
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : saved
            ? '✓ Saved'
            : <><Save className="w-4 h-4" /> Save Settings</>}
        </button>
      </div>
    </div>
  )
}
