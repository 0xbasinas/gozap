import { createApiClient } from '@repo/shared/client'
import { reconcile, type PreferencesRecord } from '@repo/shared'
import logger from 'electron-log/main'
import { accountAvailable, apiUrl, authenticatedFetch, getAccount, onAccountChanged } from './auth'
import { applyRemotePreferences, getPreferencesRecord, onSettingsChanged } from './settings'

// Keeps the theme and accent colour the same on every device the person is signed in on. The local setting is always the one the app
// uses, so everything works offline; this only reconciles with the account when it can. Last write wins (see
// reconcile in @repo/shared), and a failed attempt is simply retried by the next trigger, because the local copy
// stays the newer one until it has been sent.

const RETRY_MS = 10 * 60 * 1000
let running = false
let again = false

const local = (): PreferencesRecord => {
  const { theme, accent, updatedAt } = getPreferencesRecord()
  return { preferences: { theme, accent }, updatedAt }
}

async function syncOnce(): Promise<void> {
  const account = await getAccount()
  if (!account.user) return
  const api = createApiClient({ baseUrl: apiUrl(), fetch: authenticatedFetch })

  const mine = local()
  const remote = await api.preferences.get()
  const { winner, push } = reconcile(mine, remote)
  const saved = push ? await api.preferences.put(winner) : winner
  // `saved` is now the newest copy. If it came from another device (or the server adjusted its time), adopt it.
  if (
    saved.updatedAt !== mine.updatedAt ||
    saved.preferences.theme !== mine.preferences.theme ||
    saved.preferences.accent !== mine.preferences.accent
  ) {
    applyRemotePreferences(saved.preferences, saved.updatedAt)
  }
}

/** Run a sync; calls that arrive meanwhile are folded into one more run afterwards. Never throws. */
export async function syncPreferences(): Promise<void> {
  if (!accountAvailable()) return
  if (running) {
    again = true
    return
  }
  running = true
  try {
    do {
      again = false
      await syncOnce()
    } while (again)
  } catch (error) {
    // Offline, or the API is down: stay with the local copy and try again later.
    logger.warn('[sync] could not sync preferences', error)
  } finally {
    running = false
  }
}

/** Sync at start, after signing in, whenever the theme or accent changes, and every few minutes. */
export function startPreferencesSync(): void {
  if (!accountAvailable()) return
  onAccountChanged((account) => {
    if (account.user) void syncPreferences()
  })
  onSettingsChanged((next, previous) => {
    if (next.theme !== previous.theme || next.accent !== previous.accent) void syncPreferences()
  })
  void syncPreferences()
  setInterval(() => void syncPreferences(), RETRY_MS).unref()
}
