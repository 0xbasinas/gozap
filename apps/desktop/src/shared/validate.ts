import {
  ACCENTS,
  DEVICE_NICKNAME_MAX,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  isAccent,
  type FeedbackKind
} from '@repo/shared'
import type { FeedbackRequest, Settings } from './ipc'

const isFeedbackKind = (value: unknown): value is FeedbackKind =>
  typeof value === 'string' && (FEEDBACK_KINDS as readonly string[]).includes(value)

// The renderer is untrusted: anything it sends over IPC is checked here before main acts on it.

const SETTING_KEYS = [
  'theme',
  'accent',
  'updateChannel',
  'closeToTray',
  'launchAtLogin',
  'notifications',
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
      case 'notifications':
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

/** Validate the feedback form's payload. Throws on anything unexpected. */
export function parseFeedbackRequest(input: unknown): FeedbackRequest {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Invalid feedback: expected an object')
  }
  const { kind, message, includeDiagnostics, ...rest } = input as Record<string, unknown>
  if (Object.keys(rest).length > 0) throw new Error('Invalid feedback: unknown key')
  if (!isFeedbackKind(kind)) throw new Error('Invalid feedback: unknown kind')
  if (typeof message !== 'string') throw new Error('Invalid feedback: message must be text')
  const text = message.trim()
  if (text.length < 3 || text.length > FEEDBACK_MESSAGE_MAX) {
    throw new Error(
      'Invalid feedback: message must be 3 to ' + FEEDBACK_MESSAGE_MAX + ' characters'
    )
  }
  if (typeof includeDiagnostics !== 'boolean') {
    throw new Error('Invalid feedback: includeDiagnostics must be a boolean')
  }
  return { kind, message: text, includeDiagnostics }
}

/** A device (session) id from the page: a short plain string. It is only ever sent to the API as a path part. */
export function parseDeviceId(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input)) {
    throw new Error('Invalid device id')
  }
  return input
}

/** A device nickname: text up to the limit (blank means none), or null to remove it. */
export function parseNickname(input: unknown): string | null {
  if (input === null) return null
  if (typeof input !== 'string') throw new Error('Invalid nickname: expected text or null')
  const name = input.trim()
  if (name.length > DEVICE_NICKNAME_MAX) throw new Error('Invalid nickname: too long')
  return name === '' ? null : name
}
