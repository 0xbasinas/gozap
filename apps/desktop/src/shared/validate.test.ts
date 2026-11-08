import { describe, expect, it } from 'vitest'
import {
  parseBoolean,
  parseDeviceId,
  parseFeedbackRequest,
  parseNickname,
  parseSettingsPatch
} from './validate'

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
    expect(parseSettingsPatch({ notifications: false })).toEqual({ notifications: false })
    expect(() => parseSettingsPatch({ notifications: 'no' })).toThrow()
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

describe('parseFeedbackRequest', () => {
  const ok = { kind: 'bug', message: '  It crashes  ', includeDiagnostics: true }
  it('accepts a normal request and trims the message', () => {
    expect(parseFeedbackRequest(ok)).toEqual({ ...ok, message: 'It crashes' })
  })
  it('rejects anything else', () => {
    for (const bad of [
      null,
      'x',
      [],
      { ...ok, kind: 'rant' },
      { ...ok, message: 'hi' },
      { ...ok, message: 'x'.repeat(5000) },
      { ...ok, message: 5 },
      { ...ok, includeDiagnostics: 'yes' },
      { ...ok, extra: 1 }
    ]) {
      expect(() => parseFeedbackRequest(bad)).toThrow()
    }
  })
})

describe('device arguments', () => {
  it('accepts plain ids and rejects anything that could change the request path', () => {
    expect(parseDeviceId('abc_123-XYZ')).toBe('abc_123-XYZ')
    for (const bad of ['', '../account', 'a/b', 'a?b', 5, null, 'x'.repeat(200)]) {
      expect(() => parseDeviceId(bad)).toThrow()
    }
  })
  it('trims nicknames, turns blank into null and refuses long or non-text ones', () => {
    expect(parseNickname('  Work laptop ')).toBe('Work laptop')
    expect(parseNickname('   ')).toBeNull()
    expect(parseNickname(null)).toBeNull()
    expect(() => parseNickname('x'.repeat(41))).toThrow()
    expect(() => parseNickname(5)).toThrow()
  })
})
