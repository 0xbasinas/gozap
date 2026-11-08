import { ACCENTS, isAccent } from '@repo/shared'
import type { Settings } from './ipc'

// The renderer is untrusted: anything it sends over IPC is checked here before main acts on it.

const SETTING_KEYS = [
  'theme',
  'accent',
  'updateChannel',
  'closeToTray',
  'launchAtLogin',
  'crashReports'
] as const

/** Validate a settings patch from the renderer. Throws on anything unexpected. */
export function parseSettingsPatch(input: unknown): Partial<Settings> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid settings: expected an object')
  }

  const patch: Partial<Settings> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Invalid settings: unknown key "${key}"`)
    }
    switch (key) {
      case 'updateChannel':
        if (value !== 'latest' && value !== 'beta') {
          throw new Error('Invalid settings: updateChannel must be "latest" or "beta"')
        }
        patch.updateChannel = value
        break
      case 'theme':
        if (value !== 'system' && value !== 'light' && value !== 'dark') {
          throw new Error('Invalid settings: theme must be "system", "light" or "dark"')
        }
        patch.theme = value
        break
      case 'accent':
        if (!isAccent(value)) {
          throw new Error(`Invalid settings: accent must be one of ${ACCENTS.join(', ')}`)
        }
        patch.accent = value
        break
      case 'closeToTray':
      case 'launchAtLogin':
      case 'crashReports':
        if (typeof value !== 'boolean')
          throw new Error(`Invalid settings: ${key} must be a boolean`)
        patch[key] = value
        break
    }
  }
  return patch
}

/** Validate an optional boolean argument. */
export function parseBoolean(input: unknown, fallback = false): boolean {
  if (input === undefined) return fallback
  if (typeof input !== 'boolean') throw new Error('Invalid argument: expected a boolean')
  return input
}
