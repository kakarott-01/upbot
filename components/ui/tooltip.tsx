'use client'

import { Info } from 'lucide-react'

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex">
      <span className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-gray-700 text-gray-500 transition-colors group-hover:border-brand-500/40 group-hover:text-brand-400">
        <Info className="h-3 w-3" />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 hidden w-56 -translate-x-1/2 rounded-xl border border-gray-800 bg-gray-950 px-3 py-2 text-[11px] leading-relaxed text-gray-300 shadow-2xl group-hover:block">
        {text}
      </span>
    </span>
  )
}
