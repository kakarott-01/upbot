'use client'

import { create } from 'zustand'

type ToastTone = 'success' | 'error' | 'warning'

export type ToastItem = {
  id: string
  title: string
  description?: string
  tone: ToastTone
}

type ToastState = {
  toasts: ToastItem[]
  push: (toast: Omit<ToastItem, 'id'>) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (toast) => {
    const id = crypto.randomUUID()
    set({ toasts: [...get().toasts, { id, ...toast }] })
    window.setTimeout(() => {
      get().dismiss(id)
    }, 3200)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
}))
