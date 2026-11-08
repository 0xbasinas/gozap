import {
  emptyPreferences,
  preferencesRecordSchema,
  reconcile,
  type Preferences,
  type PreferencesRecord
} from '@repo/shared'
import { api } from './api'

// The theme and accent colour follow the person: it is kept in this browser (so it applies at once, even signed out or offline) and,
// when signed in, synced through /api/preferences so the desktop app shows the same one. Last write wins.

const KEY = 'preferences'
const darkQuery = (): MediaQueryList | undefined =>
  window.matchMedia?.('(prefers-color-scheme: dark)')

function readLocal(): PreferencesRecord {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? preferencesRecordSchema.safeParse(JSON.parse(raw)) : null
    if (parsed?.success) return parsed.data
  } catch {
    // storage unavailable or corrupt: start from the defaults
  }
  return emptyPreferences()
}

function writeLocal(record: PreferencesRecord): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(record))
  } catch {
    // private mode etc.: the theme still applies for this visit
  }
}

export function applyAccent(accent: Preferences['accent']): void {
  document.documentElement.dataset.accent = accent
}

export function applyTheme(theme: Preferences['theme']): void {
  const dark = theme === 'dark' || (theme === 'system' && darkQuery()?.matches === true)
  document.documentElement.classList.toggle('dark', dark)
}

/** Apply the saved theme and accent now, and keep following the OS setting while the theme is "system". */
export function initTheme(): void {
  applyTheme(readLocal().preferences.theme)
  applyAccent(readLocal().preferences.accent)
  darkQuery()?.addEventListener('change', () => applyTheme(readLocal().preferences.theme))
}

export const currentTheme = (): Preferences['theme'] => readLocal().preferences.theme
export const currentAccent = (): Preferences['accent'] => readLocal().preferences.accent

/** The person changed a preference: apply and remember it, then tell the server if signed in. Returns whether it was saved there. */
async function setPreference(patch: Partial<Preferences>, signedIn: boolean): Promise<boolean> {
  // Keep the other preferences: changing the theme must not reset the accent, and the other way round.
  const record: PreferencesRecord = {
    preferences: { ...readLocal().preferences, ...patch },
    updatedAt: Date.now()
  }
  writeLocal(record)
  applyTheme(record.preferences.theme)
  applyAccent(record.preferences.accent)
  if (!signedIn) return false
  try {
    writeLocal(await api.preferences.put(record))
    return true
  } catch (error) {
    // Offline or the API is down: the local copy is newer, so the next sync pushes it.
    console.error(error)
    return false
  }
}

export const setTheme = (theme: Preferences['theme'], signedIn: boolean): Promise<boolean> =>
  setPreference({ theme }, signedIn)

export const setAccent = (accent: Preferences['accent'], signedIn: boolean): Promise<boolean> =>
  setPreference({ accent }, signedIn)

/** After signing in (or on load while signed in): take the newest copy and, if ours is newer, send it. */
export async function syncTheme(): Promise<Preferences> {
  const local = readLocal()
  const remote = await api.preferences.get()
  const { winner, push } = reconcile(local, remote)
  const saved = push ? await api.preferences.put(winner) : winner
  writeLocal(saved)
  applyTheme(saved.preferences.theme)
  applyAccent(saved.preferences.accent)
  return saved.preferences
}
