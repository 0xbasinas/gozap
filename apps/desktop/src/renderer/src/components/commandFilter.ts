export interface Command {
  id: string
  label: string
  /** Extra words that also match, such as "night" for the dark theme command. */
  keywords?: string
  run: () => void
}

/** Commands whose label or keywords contain every word typed, those whose label starts with the query first. */
export function filterCommands(commands: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return commands
  const joined = words.join(' ')
  const starts = (c: Command): number => Number(c.label.toLowerCase().startsWith(joined))
  return commands
    .filter((c) => {
      const haystack = `${c.label} ${c.keywords ?? ''}`.toLowerCase()
      return words.every((w) => haystack.includes(w))
    })
    .sort((a, b) => starts(b) - starts(a))
}

/** Move the highlighted row by `delta`, wrapping around. */
export function moveIndex(index: number, delta: number, length: number): number {
  return length === 0 ? 0 : (index + delta + length) % length
}
