import { describe, expect, it } from 'vitest'
import { ageText, expectedRollout } from './status'

const NOW = Date.parse('2026-11-10T12:00:00Z')
const ago = (hours: number): string => new Date(NOW - hours * 3_600_000).toISOString()

describe('expectedRollout', () => {
  it('follows the usual schedule by age', () => {
    expect(expectedRollout(ago(2), NOW)).toBe(10)
    expect(expectedRollout(ago(30), NOW)).toBe(25)
    expect(expectedRollout(ago(50), NOW)).toBe(50)
    expect(expectedRollout(ago(80), NOW)).toBe(100)
  })
  it('says nothing for a date it cannot read', () => {
    expect(expectedRollout('', NOW)).toBeNull()
  })
})

describe('ageText', () => {
  it('reads naturally', () => {
    expect(ageText(ago(0.2), NOW)).toBe('just now')
    expect(ageText(ago(1), NOW)).toBe('1 hour ago')
    expect(ageText(ago(5), NOW)).toBe('5 hours ago')
    expect(ageText(ago(96), NOW)).toBe('4 days ago')
    expect(ageText('nope', NOW)).toBe('')
  })
})
