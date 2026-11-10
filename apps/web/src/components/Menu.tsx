import { useEffect, useId, useRef, useState, type JSX, type ReactNode } from 'react'
import { cn } from '@repo/ui'

interface MenuProps {
  /** What a screen reader calls the button. */
  label: string
  /** What the button shows. */
  trigger: ReactNode
  /** The panel's content; call `close` from an item to shut the panel. */
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

/** A small pop-up menu: closes on Escape, on a click elsewhere and when an item calls `close`. */
export function Menu({
  label,
  trigger,
  children,
  align = 'left',
  className
}: MenuProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      >
        {trigger}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-1 min-w-56 rounded-lg border border-border bg-background p-1 text-sm shadow-lg',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

/** One row of a Menu. */
export const menuItem =
  'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none'
