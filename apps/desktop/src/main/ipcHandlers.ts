import { app, BrowserWindow } from 'electron'
import { IPC, type AppInfo } from '../shared/ipc'
import {
  parseBoolean,
  parseDeviceId,
  parseFeedbackRequest,
  parseNickname,
  parseSettingsPatch
} from '../shared/validate'
import { getAccount, signIn, signOut } from './auth'
import { crashReportingAvailable } from './crashReporting'
import { listDevices, renameDevice, signOutDevice } from './devices'
import { sendFeedback } from './feedback'
import { collectDiagnostics } from './diagnostics'
import { logFilePath, revealLogs } from './logger'
import { getFlags } from './flags'
import { isUpdateRequired } from './minimumVersion'
import { getSyncStatus, syncPreferences } from './preferencesSync'
import { handle } from './secureIpc'
import { getSettings, updateSettings } from './settings'
import { openSettingsWindow } from './settingsWindow'
import { getWhatsNew, markWhatsNewSeen } from './whatsNew'

/** Handlers for settings, app info and "what's new". Update handlers live in updater.ts. */
export function registerIpcHandlers(): void {
  handle(IPC.settingsGet, () => getSettings())

  // The renderer sends a patch; parseSettingsPatch rejects anything unexpected.
  handle(IPC.settingsUpdate, (_event, patch) => updateSettings(parseSettingsPatch(patch)))

  handle(IPC.settingsOpenWindow, (event) => {
    openSettingsWindow(BrowserWindow.fromWebContents(event.sender) ?? undefined)
  })

  handle(IPC.appInfo, (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged,
    logPath: logFilePath(),
    crashReportingAvailable: crashReportingAvailable()
  }))

  handle(IPC.appOpenLogs, () => revealLogs())
  handle(IPC.appDiagnostics, () => collectDiagnostics())

  handle(IPC.devicesList, () => listDevices())
  handle(IPC.devicesRename, (_event, id, nickname) =>
    renameDevice(parseDeviceId(id), parseNickname(nickname))
  )
  handle(IPC.devicesSignOut, (_event, id) => signOutDevice(parseDeviceId(id)))
  handle(IPC.feedbackSend, (_event, request) => sendFeedback(parseFeedbackRequest(request)))
  handle(IPC.syncStatus, () => getSyncStatus())
  handle(IPC.updateRequiredGet, () => isUpdateRequired())
  handle(IPC.flagsGet, () => getFlags())
  handle(IPC.syncRetry, () => syncPreferences())

  handle(IPC.accountGet, () => getAccount())
  handle(IPC.accountSignIn, () => signIn())
  handle(IPC.accountSignOut, () => signOut())

  handle(IPC.whatsNewGet, (_event, force) => getWhatsNew(parseBoolean(force)))
  handle(IPC.whatsNewSeen, () => markWhatsNewSeen())
}
