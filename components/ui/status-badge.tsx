'use client'

import { cn } from '@/lib/utils'

type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const TONE_STYLES: Record<StatusTone, string> = {
  neutral: 'badge-gray',
  success: 'badge-green',
  warning: 'badge-amber',
  danger: 'badge-red',
  info: 'badge-blue',
}

export function StatusBadge({
  tone = 'neutral',
  className,
  children,
}: {
  tone?: StatusTone
  className?: string
  children: React.ReactNode
}) {
  return (
    <span className={cn(TONE_STYLES[tone], className)}>
      {children}
    </span>
  )
}
