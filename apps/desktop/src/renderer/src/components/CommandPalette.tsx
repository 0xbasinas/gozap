import { useEffect, useMemo, useRef, useState } from 'react'
import { filterCommands, moveIndex, type Command } from '@renderer/components/commandFilter'
import { cn } from '@repo/ui'

/** Ctrl+K / Cmd+K: type to find an action, Enter to run it, Esc to close. */
export function CommandPalette({ commands }: { commands: Command[] }): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setQuery('')
        setIndex(0)
        setOpen((value) => !value)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  const matches = useMemo(() => filterCommands(commands, query), [commands, query])
  if (!open) return null

  const run = (command: Command | undefined): void => {
    if (!command) return
    setOpen(false)
    command.run()
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      setOpen(false)
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(moveIndex(index, event.key === 'ArrowDown' ? 1 : -1, matches.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      run(matches[index])
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-black/50 p-4 pt-24"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-md overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg"
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          role="combobox"
          aria-expanded="true"
          aria-controls="command-list"
          aria-activedescendant={matches[index] ? `command-${matches[index].id}` : undefined}
          aria-label="Type a command"
          placeholder="Type a command..."
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
        />
        <ul id="command-list" role="listbox" className="max-h-72 overflow-y-auto p-1">
          {matches.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No matching command</li>
          )}
          {matches.map((command, i) => (
            <li
              key={command.id}
              id={`command-${command.id}`}
              role="option"
              aria-selected={i === index}
              className={cn(
                'cursor-pointer rounded-md px-3 py-2 text-sm',
                i === index && 'bg-accent text-accent-foreground'
              )}
              onMouseMove={() => setIndex(i)}
              onClick={() => run(command)}
            >
              {command.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
