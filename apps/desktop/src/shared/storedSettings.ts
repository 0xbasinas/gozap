import { isAccent } from '@repo/shared'
import type { Settings } from './ipc'

// What settings.json holds and how it is read back. Pure (no Electron), so it is unit tested.

export const defaults: Settings = {
  theme: 'system',
  accent: 'neutral',
  updateChannel: 'latest',
  closeToTray: false,
  launchAtLogin: false,
  crashReports: false
}

/** What is stored on disk: the user's settings plus bookkeeping the renderer never sets. */
export interface Stored extends Settings {
  lastSeenVersion: string
  /** When the theme or accent was last changed (ms since 1970); the account sync keeps the newest edit. The name is from when only the theme synced; it is kept so rolling back a release still reads it. */
  themeUpdatedAt: number
}

/** Read a parsed settings.json defensively: anything missing or invalid falls back to the default. */
export function parseStored(raw: unknown): Stored {
  const saved = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<
    Record<keyof Stored, unknown>
  >
  return {
    theme: saved.theme === 'light' || saved.theme === 'dark' ? saved.theme : defaults.theme,
    accent: isAccent(saved.accent) ? saved.accent : defaults.accent,
    themeUpdatedAt:
      typeof saved.themeUpdatedAt === 'number' && saved.themeUpdatedAt >= 0
        ? saved.themeUpdatedAt
        : 0,
    updateChannel: saved.updateChannel === 'beta' ? 'beta' : defaults.updateChannel,
    closeToTray: saved.closeToTray === true,
    launchAtLogin: saved.launchAtLogin === true,
    crashReports: saved.crashReports === true,
    lastSeenVersion: typeof saved.lastSeenVersion === 'string' ? saved.lastSeenVersion : ''
  }
}
