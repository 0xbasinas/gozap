import { cn } from './utils'

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
] as const

export type ThemeChoice = (typeof THEMES)[number]['value']

export interface ThemePickerProps {
  value: ThemeChoice | undefined
  onChange: (theme: ThemeChoice) => void
  disabled?: boolean
  /** Accessible name of the group. */
  label?: string
  className?: string
}

/**
 * Light / dark / system as three buttons. Used instead of a <select> because the open list of a native select is
 * drawn by the operating system, which ignores the app's colours.
 */
export function ThemePicker({
  value,
  onChange,
  disabled,
  label = 'Theme',
  className
}: ThemePickerProps): React.JSX.Element {
  const current = THEMES.findIndex((t) => t.value === value)
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    const index = (Math.max(current, 0) + step + THEMES.length) % THEMES.length
    const next = THEMES[index]
    if (!next) return
    onChange(next.value)
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('inline-flex rounded-md border border-input p-0.5', className)}
    >
      {THEMES.map((theme, i) => {
        const selected = theme.value === value
        return (
          <button
            key={theme.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            tabIndex={selected || (current === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(theme.value)}
            className={cn(
              'rounded px-3 py-1 text-sm transition-colors disabled:opacity-60',
              selected
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50'
            )}
          >
            {theme.label}
          </button>
        )
      })}
    </div>
  )
}
