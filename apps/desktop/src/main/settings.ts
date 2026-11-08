import { app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { Settings } from '../shared/ipc'
import { parseStored, type Stored } from '../shared/storedSettings'

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

function readStored(): Stored {
  try {
    return parseStored(JSON.parse(readFileSync(settingsPath(), 'utf8')))
  } catch {
    return parseStored(undefined)
  }
}

function writeStored(stored: Stored): void {
  writeFileSync(settingsPath(), JSON.stringify(stored, null, 2))
}

export function getSettings(): Settings {
  const { theme, accent, updateChannel, closeToTray, launchAtLogin, crashReports } = readStored()
  return { theme, accent, updateChannel, closeToTray, launchAtLogin, crashReports }
}

type Listener = (next: Settings, previous: Settings) => void
const listeners = new Set<Listener>()

/** Run `listener` whenever settings change, from the settings window, the tray, or anywhere else. */
export function onSettingsChanged(listener: Listener): void {
  listeners.add(listener)
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const previous = getSettings()
  const next: Settings = { ...previous, ...patch }
  const preferencesChanged = next.theme !== previous.theme || next.accent !== previous.accent
  const stored = readStored()
  writeStored({
    ...stored,
    ...next,
    themeUpdatedAt: preferencesChanged ? Date.now() : stored.themeUpdatedAt
  })
  listeners.forEach((listener) => listener(next, previous))
  return next
}

/** The synced preferences (theme, accent) and when they were last changed, in the shape the account sync compares. */
export function getPreferencesRecord(): {
  theme: Settings['theme']
  accent: Settings['accent']
  updatedAt: number
} {
  const { theme, accent, themeUpdatedAt } = readStored()
  return { theme, accent, updatedAt: themeUpdatedAt }
}

/** Newer preferences arrived from another device: adopt them with their own timestamp (so they are not pushed back as a new edit). */
export function applyRemotePreferences(
  prefs: Pick<Settings, 'theme' | 'accent'>,
  updatedAt: number
): void {
  const previous = getSettings()
  writeStored({ ...readStored(), ...prefs, themeUpdatedAt: updatedAt })
  const next = { ...previous, ...prefs }
  if (next.theme !== previous.theme || next.accent !== previous.accent) {
    listeners.forEach((listener) => listener(next, previous))
  }
}

/** The last app version whose "what's new" screen the user has seen ("" on first run). */
export function getLastSeenVersion(): string {
  return readStored().lastSeenVersion
}

export function setLastSeenVersion(version: string): void {
  writeStored({ ...readStored(), lastSeenVersion: version })
}
