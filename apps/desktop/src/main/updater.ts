import { app, BrowserWindow } from 'electron'
import { is } from '@electron-toolkit/utils'
import { autoUpdater } from 'electron-updater'
import { IPC, type UpdateChannel, type UpdaterEvent } from '../shared/ipc'
import { logger } from './logger'
import { handle } from './secureIpc'
import { getSettings } from './settings'

function applyChannel(channel: UpdateChannel): void {
  // "latest" = stable releases only. "beta" also accepts pre-releases published from the beta branch.
  autoUpdater.channel = channel
  autoUpdater.allowPrerelease = channel === 'beta'
}

/** Check now on the user's chosen channel. Updates only work in packaged builds. */
export async function checkForUpdates(): Promise<void> {
  if (is.dev || !app.isPackaged) return
  applyChannel(getSettings().updateChannel)
  await autoUpdater.checkForUpdates().catch((err) => console.error('[updater]', err))
}

export function setupAutoUpdater(): void {
  autoUpdater.logger = logger
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // Differential (blockmap) downloads are on by default; keep it explicit so nobody turns it off by accident.
  autoUpdater.disableDifferentialDownload = false

  // Remember the latest event so a window that opens later (or reloads) can show the current state.
  let last: UpdaterEvent | undefined
  const send = (event: UpdaterEvent): void => {
    last = event
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(IPC.updaterEvent, event))
  }

  autoUpdater.on('checking-for-update', () => send({ type: 'checking' }))
  autoUpdater.on('update-available', (info) => send({ type: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => send({ type: 'not-available' }))
  autoUpdater.on('download-progress', (p) => send({ type: 'progress', percent: p.percent }))
  autoUpdater.on('update-downloaded', (info) => send({ type: 'downloaded', version: info.version }))
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err)
    send({ type: 'error', message: err.message })
  })

  handle(IPC.updaterCheck, () => checkForUpdates())
  handle(IPC.updaterStatus, () => last)
  handle(IPC.updaterInstall, () => {
    if (last?.type === 'downloaded') autoUpdater.quitAndInstall()
  })

  void checkForUpdates()
}
