import { z } from 'zod'
import { ACCENTS } from './accents'

// Per-person preferences that follow them between the web app and the desktop app. Add a field here (with a default)
// and it syncs. Keep it small: it is stored as one row per person.

export const themeSchema = z.enum(['system', 'light', 'dark'])

export const accentSchema = z.enum(ACCENTS)

export const preferencesSchema = z.object({
  theme: themeSchema.default('system'),
  accent: accentSchema.default('neutral')
})

export type Preferences = z.infer<typeof preferencesSchema>
export const defaultPreferences: Preferences = { theme: 'system', accent: 'neutral' }

/** What is stored and exchanged: the preferences and when they were last changed (milliseconds since 1970). */
export const preferencesRecordSchema = z.object({
  preferences: preferencesSchema,
  updatedAt: z.number().int().min(0)
})

export type PreferencesRecord = z.infer<typeof preferencesRecordSchema>

/** The empty record: defaults, "changed at the beginning of time", so any real change wins over it. */
export const emptyPreferences = (): PreferencesRecord => ({
  preferences: { ...defaultPreferences },
  updatedAt: 0
})

/**
 * Last write wins. Preferences are small and changed by one person, so the newest edit simply replaces the older one;
 * on a tie the remote copy wins, so every device settles on the same value.
 */
export function newerWins(local: PreferencesRecord, remote: PreferencesRecord): PreferencesRecord {
  return local.updatedAt > remote.updatedAt ? local : remote
}

/** What a device does after fetching the remote copy: which record to keep, and whether the remote needs updating. */
export function reconcile(
  local: PreferencesRecord,
  remote: PreferencesRecord
): { winner: PreferencesRecord; push: boolean } {
  const winner = newerWins(local, remote)
  return { winner, push: winner === local && local.updatedAt > remote.updatedAt }
}

/** A device with a wrong clock must not be able to pin a far-future time that no later edit could beat. */
export function clampUpdatedAt(updatedAt: number, now: number, skewMs = 5 * 60_000): number {
  return Math.min(updatedAt, now + skewMs)
}

/** Read a stored value defensively: anything unreadable becomes the defaults instead of an error. */
export function parsePreferences(raw: unknown): Preferences {
  const result = preferencesSchema.safeParse(raw)
  return result.success ? result.data : { ...defaultPreferences }
}
