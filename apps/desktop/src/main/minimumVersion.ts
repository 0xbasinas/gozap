import { createApiClient } from '@repo/shared/client'
import { isOlderVersion } from '@repo/shared'
import logger from 'electron-log/main'
import { app, BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'
import { accountAvailable, apiUrl } from './auth'

// Forced update: the site says which version is the oldest still allowed (MIN_APP_VERSION on the API). An older app
// shows a blocking "update required" screen. It fails open: if the site cannot be reached, or the value makes no
// sense, nobody is blocked, so an outage can never lock people out of their app.

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
// After a failed check (offline at launch, say) try again soon instead of waiting for the next regular check.
const RETRY_MS = 10 * 60 * 1000

let required = false

export const isUpdateRequired = (): boolean => required

function setRequired(next: boolean): void {
  if (next === required) return
  required = next
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(IPC.updateRequiredChanged, required)
  }
}

async function check(): Promise<void> {
  let failed = false
  try {
    const { minimumVersion } = await createApiClient({ baseUrl: apiUrl() }).appConfig()
    setRequired(isOlderVersion(app.getVersion(), minimumVersion))
  } catch (error) {
    // Keep whatever we knew: a failed check neither blocks nor unblocks.
    logger.warn('[min-version] check failed', error)
    failed = true
  }
  if (failed) setTimeout(() => void check(), RETRY_MS).unref()
}

/** Check at start-up and every few hours. Does nothing in development, or when the app has no website. */
export function startMinimumVersionCheck(): void {
  if (!app.isPackaged || !accountAvailable()) return
  void check()
  setInterval(() => void check(), CHECK_EVERY_MS).unref()
}
