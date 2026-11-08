import { nextAccentIndex } from './accent-keys'
import { cn } from './utils'

export interface AccentPickerProps<T extends string> {
  /** The presets to offer, in order. Each one needs a matching `[data-accent]` rule in theme.css. */
  accents: readonly T[]
  value: T | undefined
  onChange: (accent: T) => void
  disabled?: boolean
  /** Names the group for screen readers. */
  label: string
  /** Prefix for each swatch's name, e.g. "Accent" gives "Accent blue". */
  itemLabelPrefix?: string
  className?: string
}

/** A row of colour swatches that works like a radio group: one tab stop, arrow keys move and select. */
export function AccentPicker<T extends string>({
  accents,
  value,
  onChange,
  disabled,
  label,
  itemLabelPrefix = '',
  className
}: AccentPickerProps<T>): React.JSX.Element {
  const selected = value === undefined ? -1 : accents.indexOf(value)
  // With nothing selected yet, the first swatch is the tab stop.
  const tabStop = selected === -1 ? 0 : selected

  return (
    <div role="radiogroup" aria-label={label} className={cn('flex gap-2', className)}>
      {accents.map((accent, index) => (
        <button
          key={accent}
          type="button"
          role="radio"
          aria-checked={index === selected}
          aria-label={`${itemLabelPrefix}${accent}`}
          title={accent}
          disabled={disabled}
          tabIndex={index === tabStop ? 0 : -1}
          data-accent={accent}
          onClick={() => onChange(accent)}
          onKeyDown={(event) => {
            const next = nextAccentIndex(index, event.key, accents.length)
            if (next === undefined) return
            event.preventDefault()
            onChange(accents[next]!)
            ;(event.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus()
          }}
          className={cn(
            'size-6 rounded-full bg-primary ring-offset-2 ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            index === selected ? 'ring-2 ring-ring' : 'hover:ring-2 hover:ring-ring/50'
          )}
        />
      ))}
    </div>
  )
}
