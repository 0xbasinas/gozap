import { describe, expect, it } from 'vitest'
import { filterCommands, moveIndex, type Command } from './commandFilter'

const cmd = (label: string, keywords?: string): Command => ({
  id: label,
  label,
  keywords,
  run: () => {}
})
const all = [cmd('Open settings'), cmd('Check for updates'), cmd('Dark theme', 'night mode')]

describe('filterCommands', () => {
  it('returns everything for an empty query', () => {
    expect(filterCommands(all, '  ')).toEqual(all)
  })
  it('needs every word to match, in the label or the keywords', () => {
    expect(filterCommands(all, 'check up').map((c) => c.label)).toEqual(['Check for updates'])
    expect(filterCommands(all, 'night').map((c) => c.label)).toEqual(['Dark theme'])
    expect(filterCommands(all, 'zzz')).toEqual([])
  })
  it('puts labels that start with the query first', () => {
    const list = [cmd('Show log file'), cmd('Log out'), cmd('Open log')]
    expect(filterCommands(list, 'log')[0].label).toBe('Log out')
  })
})

describe('moveIndex', () => {
  it('wraps around both ways', () => {
    expect(moveIndex(0, -1, 3)).toBe(2)
    expect(moveIndex(2, 1, 3)).toBe(0)
    expect(moveIndex(0, 1, 0)).toBe(0)
  })
})
