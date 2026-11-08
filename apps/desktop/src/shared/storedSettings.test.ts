import { describe, expect, it } from 'vitest'
import { defaults, parseStored } from './storedSettings'

describe('parseStored', () => {
  it('falls back to the defaults for missing or unreadable files', () => {
    for (const bad of [undefined, null, 'x', 5, [], {}]) {
      expect(parseStored(bad)).toEqual({ ...defaults, lastSeenVersion: '', themeUpdatedAt: 0 })
    }
  })

  it('reads a settings file from before the accent existed', () => {
    const old = {
      theme: 'dark',
      themeUpdatedAt: 1234,
      updateChannel: 'beta',
      lastSeenVersion: '1.2.3'
    }
    expect(parseStored(old)).toMatchObject({
      theme: 'dark',
      accent: 'neutral',
      themeUpdatedAt: 1234,
      updateChannel: 'beta',
      lastSeenVersion: '1.2.3'
    })
  })

  it('keeps a valid accent and drops an invalid one', () => {
    expect(parseStored({ accent: 'rose' }).accent).toBe('rose')
    expect(parseStored({ accent: 'chartreuse' }).accent).toBe('neutral')
    expect(parseStored({ accent: 5 }).accent).toBe('neutral')
  })

  it('turns notifications on unless they were switched off', () => {
    expect(parseStored({}).notifications).toBe(true)
    expect(parseStored({ notifications: false }).notifications).toBe(false)
  })

  it('ignores a negative or non-numeric timestamp', () => {
    expect(parseStored({ themeUpdatedAt: -5 }).themeUpdatedAt).toBe(0)
    expect(parseStored({ themeUpdatedAt: '9' }).themeUpdatedAt).toBe(0)
  })
})
