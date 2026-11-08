// IPC channel names and payload types shared by main, preload and renderer.
// Add new channels here first so all three processes stay in sync.

import type { Device, FeedbackKind, Preferences } from '@repo/shared'

export const IPC = {
  // renderer -> main (invoke)
  updaterCheck: 'updater:check',
  updaterStatus: 'updater:status',
  updaterInstall: 'updater:install',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsOpenWindow: 'settings:open-window',
  appInfo: 'app:info',
  appOpenLogs: 'app:open-logs',
  appDiagnostics: 'app:diagnostics',
  feedbackSend: 'feedback:send',
  updateRequiredGet: 'update-required:get',
  flagsGet: 'flags:get',
  devicesList: 'devices:list',
  devicesRename: 'devices:rename',
  devicesSignOut: 'devices:sign-out',
  syncStatus: 'sync:status',
  syncRetry: 'sync:retry',
  whatsNewGet: 'whats-new:get',
  whatsNewSeen: 'whats-new:seen',
  accountGet: 'account:get',
  accountSignIn: 'account:sign-in',
  accountSignOut: 'account:sign-out',
  // main -> renderer (events)
  updaterEvent: 'updater:event',
  settingsChanged: 'settings:changed',
  accountChanged: 'account:changed',
  updateRequiredChanged: 'update-required:changed',
  flagsChanged: 'flags:changed',
  syncChanged: 'sync:changed',
  menuCheckUpdates: 'menu:check-updates',
  menuWhatsNew: 'menu:whats-new',
  deepLink: 'deeplink:url',
  openFile: 'file:open'
} as const

export type UpdateChannel = 'latest' | 'beta'

/** User preferences. Everything here can be changed from the settings window. */
export type Theme = 'system' | 'light' | 'dark'

/** Accent colour preset (the list lives in @repo/shared so the web app offers the same ones). */
export type Accent = Preferences['accent']

export interface Settings {
  /** Light, dark or follow the system. Synced with the account's other devices when signed in. */
  theme: Theme
  /** Colour of buttons, focus rings and checkboxes. Synced with the theme. */
  accent: Accent
  updateChannel: UpdateChannel
  /** Closing the window hides it to the tray instead of quitting (Windows and Linux). */
  closeToTray: boolean
  /** Start the app when you sign in (Windows and macOS, packaged builds only). */
  launchAtLogin: boolean
  /** Show native notifications (for example when an update is ready to install). */
  notifications: boolean
  /** Send anonymous crash reports (only offered when this build has a crash-report endpoint). */
  crashReports: boolean
}

export type UpdaterEvent =
  | { type: 'checking' }
  | { type: 'available'; version: string }
  | { type: 'not-available' }
  | { type: 'progress'; percent: number }
  | { type: 'downloaded'; version: string }
  | { type: 'error'; message: string }

export interface AppInfo {
  name: string
  version: string
  platform: string
  isPackaged: boolean
  logPath: string
  /** This build can send crash reports, so the switch in Settings is shown. */
  crashReportingAvailable: boolean
}

/** Who is signed in to the app's account (the API), if this build has one. */
export interface Account {
  /** This build knows where the API is, so the Account section is shown. */
  available: boolean
  user: { email: string; name: string } | null
}

export interface WhatsNew {
  /** "first-run" the first time the app ever starts, "updated" after the version changes. */
  kind: 'first-run' | 'updated'
  version: string
  /** Release notes as Markdown. */
  notes: string
}

/** What an account action answers: done, or why not (in words the person can read). */
export type ActionResult = { ok: true } | { ok: false; error: string }
export type FeedbackResult = ActionResult
export type DevicesResult = { ok: true; devices: Device[] } | { ok: false; error: string }

/** What the feedback form sends to main. `includeDiagnostics` attaches the report from Settings. */
export interface FeedbackRequest {
  kind: FeedbackKind
  message: string
  includeDiagnostics: boolean
}
