'use client'

import { ErrorBoundary } from 'react-error-boundary'

function SectionFallback({
  resetErrorBoundary,
}: {
  resetErrorBoundary: () => void
}) {
  return (
    <div className="rounded-xl border border-red-900/30 bg-red-900/15 p-4 text-sm text-red-100">
      <p className="font-medium">This section could not load.</p>
      <button
        type="button"
        onClick={resetErrorBoundary}
        className="mt-3 rounded-lg border border-red-800/40 bg-red-900/20 px-3 py-1.5 text-xs font-semibold text-red-100 transition hover:bg-red-900/30"
      >
        Try again
      </button>
    </div>
  )
}

export function SectionErrorBoundary({ children }: { children: React.ReactNode }) {
  return (
    <ErrorBoundary FallbackComponent={SectionFallback}>
      {children}
    </ErrorBoundary>
  )
}
