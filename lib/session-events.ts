'use client'

import { create } from 'zustand'

type SessionEventState = {
  sessionExpired: boolean
  accessDenied: boolean
  notifySessionExpired: () => void
  notifyAccessDenied: () => void
  dismissSessionExpired: () => void
  dismissAccessDenied: () => void
}

export const useSessionEventStore = create<SessionEventState>((set) => ({
  sessionExpired: false,
  accessDenied: false,
  notifySessionExpired: () => set({ sessionExpired: true }),
  notifyAccessDenied: () => set({ accessDenied: true }),
  dismissSessionExpired: () => set({ sessionExpired: false }),
  dismissAccessDenied: () => set({ accessDenied: false }),
}))
