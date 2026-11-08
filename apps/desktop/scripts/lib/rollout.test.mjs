import { describe, expect, it } from 'vitest'
import { readRollout, withRollout } from './rollout.mjs'

const manifest = `version: 0.0.9
files:
  - url: app-setup.exe
    sha512: abc
path: app-setup.exe
sha512: abc
releaseDate: '2026-11-07T00:00:00.000Z'
`

describe('withRollout', () => {
  it('adds stagingPercentage below 100', () => {
    const out = withRollout(manifest, 10)
    expect(out).toContain('stagingPercentage: 10\n')
    expect(out.startsWith('version: 0.0.9')).toBe(true)
    expect(readRollout(out)).toBe(10)
  })

  it('replaces an existing value instead of adding a second one', () => {
    const out = withRollout(withRollout(manifest, 10), 50)
    expect(out.match(/stagingPercentage/g)).toHaveLength(1)
    expect(readRollout(out)).toBe(50)
  })

  it('removes stagingPercentage at 100, so everyone gets the update', () => {
    const out = withRollout(withRollout(manifest, 10), 100)
    expect(out).not.toContain('stagingPercentage')
    expect(readRollout(out)).toBe(100)
  })

  it('supports 0 to pause a release', () => {
    expect(readRollout(withRollout(manifest, 0))).toBe(0)
  })

  it('rejects nonsense', () => {
    expect(() => withRollout(manifest, 101)).toThrow()
    expect(() => withRollout(manifest, -1)).toThrow()
    expect(() => withRollout(manifest, Number.NaN)).toThrow()
  })
})
