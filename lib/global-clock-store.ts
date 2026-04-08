'use client'

import { create } from 'zustand'

type GlobalClockState = {
  now: number
  offsetMs: number
  tick: () => void
  syncWithServer: (serverNowMs: number) => void
}

function getClientNow(): number {
  return Date.now()
}

export const useGlobalClockStore = create<GlobalClockState>((set, get) => ({
  now: getClientNow(),
  offsetMs: 0,
  tick: () => {
    const { offsetMs } = get()
    set({ now: getClientNow() + offsetMs })
  },
  syncWithServer: (serverNowMs) => {
    const clientNowMs = getClientNow()
    const offsetMs = serverNowMs - clientNowMs
    set({
      offsetMs,
      now: clientNowMs + offsetMs,
    })
  },
}))
