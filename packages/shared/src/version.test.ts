import { describe, expect, it } from 'vitest'
import { isOlderVersion, parseVersion } from './version'

describe('parseVersion', () => {
  it('reads plain, prefixed and pre-release versions', () => {
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3])
    expect(parseVersion('v0.1.42')).toEqual([0, 1, 42])
    expect(parseVersion('0.1.42-beta')).toEqual([0, 1, 42])
  })
  it('rejects anything else', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.x', 'a.b.c']) expect(parseVersion(bad)).toBeNull()
  })
})

describe('isOlderVersion', () => {
  it('compares numbers, not text', () => {
    expect(isOlderVersion('0.1.9', '0.1.10')).toBe(true)
    expect(isOlderVersion('0.2.0', '0.1.99')).toBe(false)
    expect(isOlderVersion('1.0.0', '0.9.9')).toBe(false)
  })
  it('is false for the same version and for a pre-release of the minimum', () => {
    expect(isOlderVersion('0.1.5', '0.1.5')).toBe(false)
    expect(isOlderVersion('0.1.5-beta', '0.1.5')).toBe(false)
  })
  it('never blocks when there is no limit or a bad value', () => {
    expect(isOlderVersion('0.0.1', null)).toBe(false)
    expect(isOlderVersion('0.0.1', '')).toBe(false)
    expect(isOlderVersion('0.0.1', 'soon')).toBe(false)
    expect(isOlderVersion('dev', '1.0.0')).toBe(false)
  })
})
