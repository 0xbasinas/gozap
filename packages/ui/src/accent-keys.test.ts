import { describe, expect, it } from 'vitest'
import { nextAccentIndex } from './accent-keys'

describe('nextAccentIndex', () => {
  it('moves with the arrow keys and wraps around', () => {
    expect(nextAccentIndex(0, 'ArrowRight', 6)).toBe(1)
    expect(nextAccentIndex(5, 'ArrowRight', 6)).toBe(0)
    expect(nextAccentIndex(0, 'ArrowLeft', 6)).toBe(5)
    expect(nextAccentIndex(3, 'ArrowUp', 6)).toBe(2)
    expect(nextAccentIndex(3, 'ArrowDown', 6)).toBe(4)
  })

  it('jumps with Home and End and ignores other keys', () => {
    expect(nextAccentIndex(3, 'Home', 6)).toBe(0)
    expect(nextAccentIndex(3, 'End', 6)).toBe(5)
    expect(nextAccentIndex(3, 'a', 6)).toBeUndefined()
    expect(nextAccentIndex(3, 'Tab', 6)).toBeUndefined()
  })
})
