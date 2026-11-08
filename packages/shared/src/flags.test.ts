import { describe, expect, it } from 'vitest'
import { flagKeySchema, flagsQuerySchema, isFlagOn, type FlagRule } from './flags'

const rule = (patch: Partial<FlagRule> = {}): FlagRule => ({
  killed: false,
  channels: [],
  percent: 100,
  ...patch
})

describe('isFlagOn', () => {
  it('is on for everyone at 100% and off at 0%', () => {
    expect(isFlagOn('x', rule(), 'stable')).toBe(true)
    expect(isFlagOn('x', rule({ percent: 0 }), 'stable', 'abcdefgh')).toBe(false)
  })

  it('the kill switch beats everything', () => {
    expect(isFlagOn('x', rule({ killed: true }), 'stable', 'abcdefgh')).toBe(false)
  })

  it('limits by channel, and an empty list means every channel', () => {
    const betaOnly = rule({ channels: ['beta'] })
    expect(isFlagOn('x', betaOnly, 'beta')).toBe(true)
    expect(isFlagOn('x', betaOnly, 'stable')).toBe(false)
    expect(isFlagOn('x', rule({ channels: [] }), 'stable')).toBe(true)
  })

  it('gives an install the same answer every time', () => {
    const half = rule({ percent: 50 })
    const first = isFlagOn('x', half, 'stable', 'install-1234')
    for (let i = 0; i < 5; i++) expect(isFlagOn('x', half, 'stable', 'install-1234')).toBe(first)
  })

  it('only adds installs when the percentage goes up', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `install-${i}-abcdef`)
    const at = (percent: number): Set<string> =>
      new Set(ids.filter((id) => isFlagOn('x', rule({ percent }), 'stable', id)))
    const ten = at(10)
    const fifty = at(50)
    for (const id of ten) expect(fifty.has(id)).toBe(true)
    expect(fifty.size).toBeGreaterThan(ten.size)
  })

  it('lands near the asked share, and is off without an id between 0 and 100', () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `install-${i}-abcdef`)
    const on = ids.filter((id) => isFlagOn('x', rule({ percent: 30 }), 'stable', id)).length
    expect(on).toBeGreaterThan(230)
    expect(on).toBeLessThan(370)
    expect(isFlagOn('x', rule({ percent: 30 }), 'stable')).toBe(false)
  })

  it('uses a different split for each flag', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `install-${i}-abcdef`)
    const a = ids.filter((id) => isFlagOn('alpha', rule({ percent: 50 }), 'stable', id))
    const b = ids.filter((id) => isFlagOn('beta', rule({ percent: 50 }), 'stable', id))
    expect(a).not.toEqual(b)
  })
})

describe('input checks', () => {
  it('accepts safe flag keys only', () => {
    expect(flagKeySchema.safeParse('new-editor').success).toBe(true)
    for (const bad of ['', 'New', '1abc', 'a b', 'a_b', 'x'.repeat(41)])
      expect(flagKeySchema.safeParse(bad).success).toBe(false)
  })

  it('defaults the channel and rejects odd ids', () => {
    expect(flagsQuerySchema.parse({}).channel).toBe('stable')
    expect(flagsQuerySchema.safeParse({ id: 'short' }).success).toBe(false)
    expect(flagsQuerySchema.safeParse({ id: 'a'.repeat(20), channel: 'beta' }).success).toBe(true)
    expect(flagsQuerySchema.safeParse({ channel: 'nightly' }).success).toBe(false)
  })
})
