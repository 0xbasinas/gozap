import { describe, expect, it } from 'vitest'
import {
  clampUpdatedAt,
  defaultPreferences,
  emptyPreferences,
  newerWins,
  parsePreferences,
  reconcile,
  preferencesRecordSchema,
  type PreferencesRecord
} from './preferences'

const rec = (theme: 'system' | 'light' | 'dark', updatedAt: number): PreferencesRecord => ({
  preferences: { theme, accent: 'neutral' },
  updatedAt
})

describe('preferences', () => {
  it('the newest edit wins, and the remote copy wins a tie', () => {
    expect(newerWins(rec('dark', 10), rec('light', 5)).preferences.theme).toBe('dark')
    expect(newerWins(rec('dark', 5), rec('light', 10)).preferences.theme).toBe('light')
    expect(newerWins(rec('dark', 5), rec('light', 5)).preferences.theme).toBe('light')
  })

  it('any real edit beats the empty record', () => {
    expect(newerWins(rec('dark', 1), emptyPreferences()).preferences.theme).toBe('dark')
  })

  it('reconcile says whether to push', () => {
    expect(reconcile(rec('dark', 10), rec('light', 5))).toMatchObject({ push: true })
    expect(reconcile(rec('dark', 5), rec('light', 10))).toMatchObject({ push: false })
    expect(reconcile(rec('dark', 5), rec('light', 5))).toMatchObject({ push: false })
    expect(reconcile(emptyPreferences(), emptyPreferences())).toMatchObject({ push: false })
  })

  it('clamps times far in the future', () => {
    expect(clampUpdatedAt(1000, 2000)).toBe(1000)
    expect(clampUpdatedAt(10_000_000, 2000)).toBe(2000 + 5 * 60_000)
  })

  it('reads stored values defensively and fills defaults', () => {
    expect(parsePreferences({ theme: 'dark' })).toEqual({ theme: 'dark', accent: 'neutral' })
    expect(parsePreferences({ theme: 'light', accent: 'blue' })).toEqual({
      theme: 'light',
      accent: 'blue'
    })
    expect(parsePreferences({ accent: 'chartreuse' })).toEqual(defaultPreferences)
    expect(parsePreferences({ theme: 'pink' })).toEqual(defaultPreferences)
    expect(parsePreferences(null)).toEqual(defaultPreferences)
    expect(parsePreferences({})).toEqual(defaultPreferences)
  })

  it('validates what travels over the wire', () => {
    expect(preferencesRecordSchema.safeParse(rec('light', 5)).success).toBe(true)
    expect(preferencesRecordSchema.safeParse(rec('light', -1)).success).toBe(false)
    expect(
      preferencesRecordSchema.safeParse({ preferences: { theme: 'x' }, updatedAt: 1 }).success
    ).toBe(false)
    expect(preferencesRecordSchema.safeParse(rec('light', 1.5)).success).toBe(false)
    expect(
      preferencesRecordSchema.safeParse({
        preferences: { theme: 'light', accent: 'url(javascript:x)' },
        updatedAt: 1
      }).success
    ).toBe(false)
  })
})
