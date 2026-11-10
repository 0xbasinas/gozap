import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { getSettings } from './settings'

// Remote crash reporting is off unless BOTH are true:
//   1. the build has a Sentry DSN (set the SENTRY_DSN secret; see docs/releasing/rollouts.md), and
//   2. the user turned on "Send anonymous crash reports" in Settings.
// Reports carry the app version and update channel, never the user's name or IP address.

declare const __SENTRY_DSN__: string

/** True when this build can send crash reports at all (so Settings knows whether to show the switch). */
export function crashReportingAvailable(): boolean {
  return Boolean(__SENTRY_DSN__) && app.isPackaged
}

let active = false

/** Call as early as possible, before the app is ready. A change in Settings applies on the next start. */
export function setupCrashReporting(): void {
  if (!crashReportingAvailable() || !getSettings().crashReports) return

  Sentry.init({
    dsn: __SENTRY_DSN__,
    // The release name is what the rollout guard looks at, so it must be exactly the app version.
    release: app.getVersion(),
    environment: getSettings().updateChannel === 'beta' ? 'beta' : 'stable',
    beforeSend(event) {
      delete event.user
      delete event.server_name
      return event
    }
  })
  active = true
}

/** Record that a renderer process died. Safe to call when reporting is off. */
export function reportRendererCrash(reason: string): void {
  if (!active) return
  Sentry.captureMessage(`Renderer process gone: ${reason}`, 'fatal')
}
