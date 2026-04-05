'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type AlertTone = 'success' | 'warning' | 'danger' | 'info'

const toneConfig: Record<AlertTone, { icon: any; className: string }> = {
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-500/20 bg-amber-500/10 text-amber-100',
  },
  danger: {
    icon: XCircle,
    className: 'border-red-500/20 bg-red-500/10 text-red-100',
  },
  info: {
    icon: Info,
    className: 'border-sky-500/20 bg-sky-500/10 text-sky-100',
  },
}

export function InlineAlert({
  tone,
  title,
  children,
  className,
}: {
  tone: AlertTone
  title?: string
  children: React.ReactNode
  className?: string
}) {
  const Icon = toneConfig[tone].icon
  return (
    <div className={cn('rounded-2xl border px-3.5 py-3', toneConfig[tone].className, className)}>
      <div className="flex items-start gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" />
        <div className="space-y-1">
          {title ? <p className="text-sm font-semibold">{title}</p> : null}
          <div className="text-xs leading-relaxed opacity-90">{children}</div>
        </div>
      </div>
    </div>
  )
}
