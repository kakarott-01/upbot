'use client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ToastViewport } from '@/components/ui/toast-viewport'
import { useToastStore } from '@/lib/toast-store'
import { POLL_INTERVALS } from '@/lib/polling-config'
import { useSessionEventStore } from '@/lib/session-events'

// Track if we've already shown the session expired toast to prevent spam
let sessionExpiredToastShown = false

export function Providers({ children }: { children: React.ReactNode }) {
  const pushToast = useToastStore((s) => s.push)
  const notifySessionExpired = useSessionEventStore((s) => s.notifySessionExpired)
  const notifyAccessDenied = useSessionEventStore((s) => s.notifyAccessDenied)

  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: (error: Error & { status?: number }, query) => {
        if (typeof window === 'undefined') return

        if (error.status === 401 && window.location.pathname !== '/login') {
          if (!sessionExpiredToastShown) {
            sessionExpiredToastShown = true
            notifySessionExpired()
            try {
              pushToast({ tone: 'error', title: 'Session expired', description: 'Please re-login.' })
            } catch (_) {}
            setTimeout(() => { sessionExpiredToastShown = false }, 10_000)
          }
          return
        }

        if (error.status === 403 && window.location.pathname !== '/access') {
          notifyAccessDenied()
          try {
            pushToast({ tone: 'error', title: 'Access denied', description: 'You no longer have access.' })
          } catch (_) {}
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: POLL_INTERVALS.BOT_IDLE,
        // Disable global polling by default — enable polling per-query where needed
        refetchInterval: false,
        refetchOnWindowFocus: false,
        retry: (failureCount, error: Error & { status?: number }) => {
          if (error.status === 401 || error.status === 403) return false
          return failureCount < 1
        },
      },
    },
  }))

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ToastViewport />
    </QueryClientProvider>
  )
}
