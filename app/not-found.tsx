import Link from 'next/link'
import { Home, SearchX } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="min-h-screen bg-gray-950 px-4 py-10 text-gray-100 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-3xl flex-col items-center justify-center text-center">
        <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg border border-gray-800 bg-gray-900/80">
          <SearchX className="h-7 w-7 text-brand-400" />
        </div>

        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-brand-400">
          404
        </p>
        <h1 className="text-3xl font-semibold text-gray-50 sm:text-4xl">
          This route is off the chart.
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-gray-400">
          The page you opened is not available. Head back to the dashboard and keep the bot on known ground.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-500/20 bg-brand-500 px-4 py-2.5 text-sm font-semibold text-gray-950 transition hover:bg-brand-400"
          >
            <Home className="h-4 w-4" />
            Go to Dashboard
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-semibold text-gray-200 transition hover:bg-gray-800"
          >
            Sign In
          </Link>
        </div>
      </div>
    </main>
  )
}
