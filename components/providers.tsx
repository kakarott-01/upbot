'use client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
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
    </QueryClientProvider>
  )
}