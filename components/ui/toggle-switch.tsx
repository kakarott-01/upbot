'use client'

/**
 * ToggleSwitch — a properly sized, non-overlapping toggle.
 * 
 * Usage:
 *   <ToggleSwitch checked={value} onChange={setValue} disabled={false} />
 * 
 * The root element is w-11 h-6 (44×24px).
 * The thumb is w-5 h-5, inset 2px, translates 20px when on.
 */

interface ToggleSwitchProps {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  colorOn?: string   // tailwind bg class when on,  default 'bg-brand-500'
  colorOff?: string  // tailwind bg class when off, default 'bg-gray-600'
}

export function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
  colorOn  = 'bg-brand-500',
  colorOff = 'bg-gray-600',
}: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={[
        // Track
        'relative inline-flex flex-shrink-0',
        'w-11 h-6 rounded-full',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50',
        checked ? colorOn : colorOff,
        disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      {/* Thumb */}
      <span
        className={[
          'pointer-events-none absolute top-0.5 left-0.5',
          'w-5 h-5 rounded-full bg-white shadow-sm',
          'transition-transform duration-200 ease-in-out',
          checked ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  )
}