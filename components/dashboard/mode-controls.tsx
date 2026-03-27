'use client'

// components/dashboard/mode-controls.tsx
//
// Renders the per-market mode toggles (PAPER ↔ LIVE).
// Handles:
//  - Disabling toggles when bot is running
//  - Warning modal before any live switch
//  - OTP verification modal (reuses existing /api/exchange/send-reveal-otp flow)
//  - Audit log display

import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Shield, Clock, CheckCircle,
  Loader2, Lock, MailCheck, X, ChevronDown, ChevronUp,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type TradingMode = 'paper' | 'live'

interface MarketModeState {
  marketType: string
  mode:       TradingMode
  isActive:   boolean
  updatedAt:  string
}

interface ModesResponse {
  botRunning: boolean
  markets:    MarketModeState[]
}

interface AuditLog {
  id:        string
  scope:     string
  fromMode:  TradingMode
  toMode:    TradingMode
  ipAddress: string
  createdAt: string
}

// ── Market display config ──────────────────────────────────────────────────────

const MARKET_LABELS: Record<string, string> = {
  indian:      '🇮🇳 Indian Markets',
  crypto:      '₿ Crypto',
  commodities: '🛢 Commodities',
  global:      '🌐 Global',
}

// ── OTP Modal (reused from existing reveal-OTP flow) ──────────────────────────

interface OtpModalProps {
  email:      string
  onVerified: () => void
  onClose:    () => void
}

function OtpModal({ email, onVerified, onClose }: OtpModalProps) {
  const [digits,    setDigits]    = useState(['', '', '', '', '', ''])
  const [error,     setError]     = useState('')
  const [sending,   setSending]   = useState(false)
  const [sent,      setSent]      = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [cooldown,  setCooldown]  = useState(0)
  const refs = useRef<(HTMLInputElement | null)[]>([])

  useEffect(() => { sendOtp() }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function sendOtp() {
    setSending(true); setError('')
    const res = await fetch('/api/exchange/send-reveal-otp', { method: 'POST' })
    setSending(false)
    if (res.ok) { setSent(true); setCooldown(60); setTimeout(() => refs.current[0]?.focus(), 100) }
    else { const d = await res.json(); setError(d.error ?? 'Failed to send OTP') }
  }

  async function verify() {
    const code = digits.join('')
    if (code.length !== 6) return
    setVerifying(true); setError('')
    const res = await fetch('/api/exchange/verify-reveal-otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ otp: code }),
    })
    setVerifying(false)
    if (res.ok) { onVerified() }
    else {
      const d = await res.json()
      setError(d.error ?? 'Invalid OTP')
      setDigits(['', '', '', '', '', ''])
      setTimeout(() => refs.current[0]?.focus(), 50)
    }
  }

  function handleDigit(val: string, idx: number) {
    if (!/^\d*$/.test(val)) return
    const next = [...digits]; next[idx] = val.slice(-1); setDigits(next)
    if (val && idx < 5) refs.current[idx + 1]?.focus()
    if (next.every(d => d) && val) setTimeout(verify, 80)
  }

  function handleKeyDown(e: React.KeyboardEvent, idx: number) {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) refs.current[idx - 1]?.focus()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-brand-500/15 flex items-center justify-center">
              <Lock className="w-4 h-4 text-brand-500" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-100">Verify to enable Live Trading</p>
              <p className="text-xs text-gray-500">OTP security check</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-5">
          {sending && !sent ? (
            <div className="flex flex-col items-center py-4 gap-3">
              <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
              <p className="text-sm text-gray-400">Sending OTP to your email…</p>
            </div>
          ) : (
            <>
              <div className="flex items-start gap-2.5 bg-brand-500/5 border border-brand-500/15 rounded-xl px-3.5 py-3 mb-5">
                <MailCheck className="w-4 h-4 text-brand-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-gray-400">
                  A 6-digit code was sent to{' '}
                  <span className="text-gray-200 font-medium">{email}</span>.
                  Enter it below to enable live trading.
                </p>
              </div>
              <div className="flex gap-2 justify-center mb-4">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={el => { refs.current[i] = el }}
                    value={d}
                    onChange={e => handleDigit(e.target.value, i)}
                    onKeyDown={e => handleKeyDown(e, i)}
                    maxLength={1}
                    inputMode="numeric"
                    autoFocus={i === 0 && sent}
                    className="w-11 h-12 text-center text-lg font-semibold bg-gray-800 border border-gray-700
                               rounded-lg text-gray-100 focus:border-brand-500 focus:ring-1
                               focus:ring-brand-500/30 outline-none transition-all"
                  />
                ))}
              </div>
              {error && <p className="text-xs text-red-400 text-center mb-3">{error}</p>}
              <button
                onClick={verify}
                disabled={digits.join('').length !== 6 || verifying}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all
                           bg-brand-500 hover:bg-brand-600 text-white
                           disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed"
              >
                {verifying
                  ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Verifying…</span>
                  : 'Verify & Enable Live'}
              </button>
              <button
                onClick={sendOtp}
                disabled={cooldown > 0 || sending}
                className="w-full mt-2 py-2 text-xs text-gray-500 hover:text-gray-300 disabled:text-gray-700 disabled:cursor-not-allowed transition-colors"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend OTP'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Warning modal (shown before OTP for paper → live) ─────────────────────────

interface WarningModalProps {
  marketType: string
  onConfirm:  () => void
  onClose:    () => void
}

function LiveWarningModal({ marketType, onConfirm, onClose }: WarningModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-red-900/40 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-red-900/30 bg-red-950/20">
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center flex-shrink-0">
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-red-300">Enable Live Trading</p>
            <p className="text-xs text-red-400/70">{MARKET_LABELS[marketType] ?? marketType}</p>
          </div>
        </div>

        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed">
            You are about to switch to{' '}
            <span className="text-red-400 font-semibold">LIVE mode</span> for{' '}
            <span className="text-white font-medium">{MARKET_LABELS[marketType]}</span>.
            Real funds will be used for all trades on this market.
          </p>

          <div className="bg-red-950/30 border border-red-900/30 rounded-xl px-4 py-3 space-y-2">
            {[
              'Real money will be spent on trades',
              'Losses are real and not recoverable',
              'Ensure your API keys have correct permissions',
              'Start with conservative risk settings',
            ].map((warning, i) => (
              <div key={i} className="flex items-start gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                <span className="text-xs text-red-300/80">{warning}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-gray-800 hover:bg-gray-700
                         text-gray-300 border border-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500
                         text-white transition-colors"
            >
              I Understand — Continue
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Paper → Live confirmation modal (no OTP needed) ───────────────────────────

interface PaperConfirmModalProps {
  marketType: string
  onConfirm:  () => void
  onClose:    () => void
}

function PaperConfirmModal({ marketType, onConfirm, onClose }: PaperConfirmModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(3,7,18,0.85)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <p className="text-sm font-semibold text-gray-100">Switch to Paper Mode</p>
          <button onClick={onClose} className="text-gray-600 hover:text-gray-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-400">
            Switch <span className="text-white font-medium">{MARKET_LABELS[marketType]}</span> back to paper mode? No real trades will be placed.
          </p>
          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors">
              Cancel
            </button>
            <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-brand-500 hover:bg-brand-600 text-white transition-colors">
              Switch to Paper
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Audit log display ─────────────────────────────────────────────────────────

function AuditLog() {
  const [open, setOpen] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['mode-audit'],
    queryFn:  () => fetch('/api/mode/audit?limit=10').then(r => r.json()),
    enabled:  open,
  })

  const logs: AuditLog[] = data?.logs ?? []

  return (
    <div className="border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-800/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5 text-gray-500" />
          <span className="text-xs font-medium text-gray-400">Mode Switch History</span>
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 text-gray-600" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-600" />}
      </button>

      {open && (
        <div className="border-t border-gray-800">
          {isLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-gray-600" />
            </div>
          ) : logs.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-6">No mode switches yet</p>
          ) : (
            <div className="divide-y divide-gray-800/50">
              {logs.map(log => (
                <div key={log.id} className="flex items-center justify-between px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 capitalize">{log.scope.replace('exchange:', '')}</span>
                    <span className="text-xs text-gray-600">·</span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      log.fromMode === 'paper'
                        ? 'bg-amber-900/20 text-amber-400'
                        : 'bg-red-900/20 text-red-400'
                    }`}>{log.fromMode}</span>
                    <span className="text-xs text-gray-600">→</span>
                    <span className={`text-xs font-mono px-1.5 py-0.5 rounded ${
                      log.toMode === 'paper'
                        ? 'bg-amber-900/20 text-amber-400'
                        : 'bg-red-900/20 text-red-400'
                    }`}>{log.toMode}</span>
                  </div>
                  <span className="text-xs text-gray-600">
                    {new Date(log.createdAt).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function ModeControls() {
  const qc = useQueryClient()

  // Pending action state: which market + which target mode is being processed
  const [pending, setPending] = useState<{
    marketType: string
    toMode:     TradingMode
    step:       'warning' | 'otp' | 'paper-confirm'
  } | null>(null)

  const { data: meData } = useQuery({
    queryKey: ['me'],
    queryFn:  () => fetch('/api/me').then(r => r.json()),
    staleTime: Infinity,
  })

  const { data, isLoading } = useQuery<ModesResponse>({
    queryKey:        ['market-modes'],
    queryFn:         () => fetch('/api/mode').then(r => r.json()),
    refetchInterval: 10_000,
  })

  const switchMut = useMutation({
    mutationFn: async ({ marketType, toMode }: { marketType: string; toMode: TradingMode }) => {
      const res  = await fetch('/api/mode', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ marketType, toMode }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? 'Failed to switch mode')
      return body
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['market-modes'] })
      setPending(null)
    },
    onError: (err: Error) => {
      // Surface the error — modal stays open
      console.error('Mode switch failed:', err.message)
    },
  })

  const botRunning = data?.botRunning ?? false
  const markets    = data?.markets ?? []
  const userEmail  = meData?.email ?? 'your email'

  function requestSwitch(marketType: string, toMode: TradingMode) {
    if (botRunning) return  // guard: should be disabled in UI too
    if (toMode === 'live') {
      setPending({ marketType, toMode, step: 'warning' })
    } else {
      setPending({ marketType, toMode, step: 'paper-confirm' })
    }
  }

  function handleWarningConfirmed() {
    if (!pending) return
    setPending({ ...pending, step: 'otp' })
  }

  function handleOtpVerified() {
    if (!pending) return
    // OTP sets the reveal_token cookie; now fire the actual switch
    switchMut.mutate({ marketType: pending.marketType, toMode: pending.toMode })
  }

  function handlePaperConfirmed() {
    if (!pending) return
    switchMut.mutate({ marketType: pending.marketType, toMode: pending.toMode })
  }

  // Determine which markets to show — fall back to all 4 if no configs yet
  const ALL_MARKETS = ['indian', 'crypto', 'commodities', 'global']
  const displayMarkets = ALL_MARKETS.map(mt => {
    const found = markets.find(m => m.marketType === mt)
    return found ?? { marketType: mt, mode: 'paper' as TradingMode, isActive: false, updatedAt: '' }
  })

  return (
    <>
      {/* Modals */}
      {pending?.step === 'warning' && (
        <LiveWarningModal
          marketType={pending.marketType}
          onConfirm={handleWarningConfirmed}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.step === 'otp' && (
        <OtpModal
          email={userEmail}
          onVerified={handleOtpVerified}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.step === 'paper-confirm' && (
        <PaperConfirmModal
          marketType={pending.marketType}
          onConfirm={handlePaperConfirmed}
          onClose={() => setPending(null)}
        />
      )}

      <div className="card space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-brand-500" />
            <h2 className="text-sm font-medium text-gray-200">Trading Mode</h2>
          </div>
          {botRunning && (
            <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-900/20
                            border border-amber-900/30 rounded-lg px-2.5 py-1">
              <AlertTriangle className="w-3 h-3" />
              Stop bot to change modes
            </div>
          )}
        </div>

        {/* Per-market toggle rows */}
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-gray-600" />
          </div>
        ) : (
          <div className="space-y-3">
            {displayMarkets.map(({ marketType, mode }) => {
              const isLive    = mode === 'live'
              const switching = switchMut.isPending &&
                pending?.marketType === marketType

              return (
                <div
                  key={marketType}
                  className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-colors ${
                    isLive
                      ? 'bg-red-950/20 border-red-900/40'
                      : 'bg-gray-800/40 border-gray-700/50'
                  }`}
                >
                  {/* Left: market name + badge */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-gray-300">
                      {MARKET_LABELS[marketType] ?? marketType}
                    </span>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${
                      isLive
                        ? 'bg-red-900/30 border-red-800/40 text-red-400'
                        : 'bg-amber-900/20 border-amber-800/30 text-amber-400'
                    }`}>
                      {isLive ? '🔴 LIVE' : '🟡 PAPER'}
                    </span>
                  </div>

                  {/* Right: toggle */}
                  <div className="flex items-center gap-2">
                    {switching && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
                    )}
                    <button
                      disabled={botRunning || switching}
                      onClick={() => requestSwitch(marketType, isLive ? 'paper' : 'live')}
                      title={botRunning ? 'Stop bot to change mode' : undefined}
                      className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                        botRunning || switching
                          ? 'opacity-40 cursor-not-allowed'
                          : 'cursor-pointer'
                      } ${isLive ? 'bg-red-600' : 'bg-gray-600'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow
                                        transition-transform duration-200 ${
                        isLive ? 'translate-x-5' : 'translate-x-0.5'
                      }`} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Info note */}
        <p className="text-xs text-gray-600 leading-relaxed">
          Mode changes take effect on the next bot start. Switching requires the bot to be stopped.
          Paper → Live requires OTP verification.
        </p>

        {/* Audit log */}
        <AuditLog />
      </div>
    </>
  )
}