import { describe, expect, it } from 'vitest'
import { parseBoolean, parseSettingsPatch } from './validate'

describe('parseSettingsPatch', () => {
  it('accepts valid partial settings', () => {
    expect(parseSettingsPatch({ updateChannel: 'beta' })).toEqual({ updateChannel: 'beta' })
    expect(parseSettingsPatch({ closeToTray: true, launchAtLogin: false })).toEqual({
      closeToTray: true,
      launchAtLogin: false
    })
    expect(parseSettingsPatch({ crashReports: true })).toEqual({ crashReports: true })
    expect(parseSettingsPatch({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(() => parseSettingsPatch({ theme: 'pink' })).toThrow(/theme/)
    expect(parseSettingsPatch({ accent: 'blue' })).toEqual({ accent: 'blue' })
    expect(() => parseSettingsPatch({ accent: 'pink' })).toThrow(/accent/)
    expect(() => parseSettingsPatch({ accent: 'url(x)' })).toThrow(/accent/)
    expect(() => parseSettingsPatch({ accent: 5 })).toThrow(/accent/)
    expect(() => parseSettingsPatch({ crashReports: 'yes' })).toThrow()
    expect(parseSettingsPatch({})).toEqual({})
  })

  it('rejects anything that is not a plain object', () => {
    for (const bad of [null, undefined, 'beta', 5, ['beta']]) {
      expect(() => parseSettingsPatch(bad)).toThrow()
    }
  })

  it('rejects unknown keys, so the renderer cannot write arbitrary settings', () => {
    expect(() => parseSettingsPatch({ lastSeenVersion: '9.9.9' })).toThrow(/unknown key/)
    expect(() => parseSettingsPatch({ __proto__: { x: 1 }, nope: 1 })).toThrow()
  })

  it('rejects wrong value types', () => {
    expect(() => parseSettingsPatch({ updateChannel: 'nightly' })).toThrow(/updateChannel/)
    expect(() => parseSettingsPatch({ closeToTray: 'yes' })).toThrow(/closeToTray/)
    expect(() => parseSettingsPatch({ launchAtLogin: 1 })).toThrow(/launchAtLogin/)
  })
})

describe('parseBoolean', () => {
  it('uses the fallback when missing and rejects non-booleans', () => {
    expect(parseBoolean(undefined)).toBe(false)
    expect(parseBoolean(undefined, true)).toBe(true)
    expect(parseBoolean(true)).toBe(true)
    expect(() => parseBoolean('true')).toThrow()
  })
})
