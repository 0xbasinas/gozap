import { createApiClient } from '@repo/shared/client'
import logger from 'electron-log/main'
import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { accountAvailable, apiUrl } from './auth'
import { getSettings, onSettingsChanged } from './settings'

// Feature flags: the site decides which features are on for this install, without a release. A flag that is not
// known (offline, or never created) is off, and a failed refresh keeps the last answer, so nothing flips by accident.
// The kill switch on the server reaches the app within one refresh.

const REFRESH_MS = 5 * 60 * 1000

let flags: Record<string, boolean> = {}

export const getFlags = (): Record<string, boolean> => flags

/** A random id for this install, made once. It is only ever sent to the flags route, and it is not tied to an account. */
function installId(): string {
  const file = join(app.getPath('userData'), 'install-id')
  try {
    // Read directly instead of checking first: the file could change between a check and the read.
    const saved = readFileSync(file, 'utf8').trim()
    if (/^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved
  } catch {
    // Missing or unreadable: make a new one.
  }
  const id = randomUUID()
  try {
    writeFileSync(file, id)
  } catch (error) {
    logger.warn('[flags] could not save the install id', error)
  }
  return id
}

function setFlags(next: Record<string, boolean>): void {
  const same =
    Object.keys(next).length === Object.keys(flags).length &&
    Object.entries(next).every(([key, on]) => flags[key] === on)
  if (same) return
  flags = next
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.flagsChanged, flags)
}

async function refresh(): Promise<void> {
  try {
    const answer = await createApiClient({ baseUrl: apiUrl() }).flags(
      getSettings().updateChannel === 'beta' ? 'beta' : 'stable',
      installId()
    )
    setFlags(answer.flags)
  } catch (error) {
    logger.warn('[flags] refresh failed', error)
  }
}

/** Fetch at start-up, every few minutes, and when the update channel changes. Nothing happens without a website. */
export function startFlags(): void {
  if (!accountAvailable()) return
  void refresh()
  setInterval(() => void refresh(), REFRESH_MS).unref()
  onSettingsChanged((next, previous) => {
    if (next.updateChannel !== previous.updateChannel) void refresh()
  })
}
