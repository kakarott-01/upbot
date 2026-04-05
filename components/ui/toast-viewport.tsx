'use client'

import { CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react'
import { useToastStore } from '@/lib/toast-store'
import { cn } from '@/lib/utils'

const toneStyles = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/20 bg-emerald-950/90 text-emerald-50',
  },
  error: {
    icon: XCircle,
    className: 'border-red-500/20 bg-red-950/90 text-red-50',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-500/20 bg-amber-950/90 text-amber-50',
  },
} as const

export function ToastViewport() {
  const { toasts, dismiss } = useToastStore()

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = toneStyles[toast.tone].icon
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur',
              toneStyles[toast.tone].className,
            )}
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.description ? (
                  <p className="mt-1 text-xs opacity-85">{toast.description}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="rounded-full p-1 text-current/70 transition hover:bg-white/10 hover:text-current"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
