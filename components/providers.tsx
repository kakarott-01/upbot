'use client'
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { ToastViewport } from '@/components/ui/toast-viewport'
import { useToastStore } from '@/lib/toast-store'

export function Providers({ children }: { children: React.ReactNode }) {
  const pushToast = useToastStore((s) => s.push)

  const [queryClient] = useState(() => new QueryClient({
    queryCache: new QueryCache({
      onError: (error: Error & { status?: number }, query) => {
        if (typeof window === 'undefined') return

        // Do not perform an immediate redirect from background polling.
        // Instead mark session state and surface a persistent banner/toast.
        if (error.status === 401 && window.location.pathname !== '/login') {
          try { window.localStorage.setItem('sessionExpired', '1') } catch (_) {}
          try {
            pushToast({ tone: 'error', title: 'Session expired', description: 'Please re-login.' })
          } catch (_) {}
          return
        }

        if (error.status === 403 && window.location.pathname !== '/access') {
          try { window.localStorage.setItem('accessDenied', '1') } catch (_) {}
          try {
            pushToast({ tone: 'error', title: 'Access denied', description: 'You no longer have access.' })
          } catch (_) {}
        }
      },
    }),
    defaultOptions: {
      queries: {
        // PERFORMANCE: Raised from 5s → 15s.
        // Most data (trades, bot status) is written by the bot engine, not the UI.
        // 15s freshness means 3× fewer background refetches with identical UX.
        staleTime: 15_000,

        // Background polling every 15s matches staleTime — avoids the pattern
        // where data is marked stale immediately before the next refetch fires.
        refetchInterval: 15_000,

        // Don't refetch on window focus — prevents jarring re-renders when
        // the user alt-tabs back to the dashboard.
        refetchOnWindowFocus: false,

        // Keep previous data while fetching — UI never goes blank mid-page.
        placeholderData: (prev: any) => prev,

        // One retry on error (network hiccup), not three.
        retry: 1,
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
