import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type Account,
  type ActionResult,
  type AppInfo,
  type DevicesResult,
  type FeedbackRequest,
  type FeedbackResult,
  type Settings,
  type UpdaterEvent,
  type WhatsNew
} from '../shared/ipc'
import type { SyncStatus } from '../shared/syncStatus'

/** Subscribe to a main -> renderer channel. Returns an unsubscribe function. */
const subscribe = <T>(channel: string, callback: (payload: T) => void): (() => void) => {
  const listener = (_event: IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/**
 * Everything the page can ask main to do. Keep this surface small and specific: the renderer is
 * sandboxed on purpose, so never expose raw `ipcRenderer`, `fs` or other general-purpose tools.
 */
export const api = {
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  },

  // Updates
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.updaterCheck),
  getUpdaterStatus: (): Promise<UpdaterEvent | undefined> => ipcRenderer.invoke(IPC.updaterStatus),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updaterInstall),

  // Settings and app info
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsUpdate, patch),
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.settingsOpenWindow),
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.appInfo),
  openLogs: (): Promise<void> => ipcRenderer.invoke(IPC.appOpenLogs),
  /** A text report (versions, GPU, settings, log tail) the user can copy into a bug report. */
  getDiagnostics: (): Promise<string> => ipcRenderer.invoke(IPC.appDiagnostics),

  // Account (sign in through the system browser)
  getAccount: (): Promise<Account> => ipcRenderer.invoke(IPC.accountGet),
  signIn: (): Promise<void> => ipcRenderer.invoke(IPC.accountSignIn),
  signOut: (): Promise<void> => ipcRenderer.invoke(IPC.accountSignOut),

  // Where the person is signed in (main calls the API as them)
  listDevices: (): Promise<DevicesResult> => ipcRenderer.invoke(IPC.devicesList),
  renameDevice: (id: string, nickname: string | null): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.devicesRename, id, nickname),
  signOutDevice: (id: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.devicesSignOut, id),

  // Feedback (sent by main, as the signed-in person)
  sendFeedback: (request: FeedbackRequest): Promise<FeedbackResult> =>
    ipcRenderer.invoke(IPC.feedbackSend, request),

  // Account sync
  getFlags: (): Promise<Record<string, boolean>> => ipcRenderer.invoke(IPC.flagsGet),
  onFlagsChanged: (cb: (flags: Record<string, boolean>) => void): (() => void) =>
    subscribe(IPC.flagsChanged, cb),
  getUpdateRequired: (): Promise<boolean> => ipcRenderer.invoke(IPC.updateRequiredGet),
  onUpdateRequiredChanged: (cb: (required: boolean) => void): (() => void) =>
    subscribe(IPC.updateRequiredChanged, cb),
  getSyncStatus: (): Promise<SyncStatus> => ipcRenderer.invoke(IPC.syncStatus),
  retrySync: (): Promise<void> => ipcRenderer.invoke(IPC.syncRetry),

  // First run and "what's new"
  getWhatsNew: (force = false): Promise<WhatsNew | undefined> =>
    ipcRenderer.invoke(IPC.whatsNewGet, force),
  markWhatsNewSeen: (): Promise<void> => ipcRenderer.invoke(IPC.whatsNewSeen),

  // Events from main
  onUpdaterEvent: (cb: (event: UpdaterEvent) => void): (() => void) =>
    subscribe(IPC.updaterEvent, cb),
  onSyncStatusChanged: (cb: (status: SyncStatus) => void): (() => void) =>
    subscribe(IPC.syncChanged, cb),
  onAccountChanged: (cb: (account: Account) => void): (() => void) =>
    subscribe(IPC.accountChanged, cb),
  onSettingsChanged: (cb: (settings: Settings) => void): (() => void) =>
    subscribe(IPC.settingsChanged, cb),
  onMenuCheckUpdates: (cb: () => void): (() => void) => subscribe<void>(IPC.menuCheckUpdates, cb),
  onMenuWhatsNew: (cb: () => void): (() => void) => subscribe<void>(IPC.menuWhatsNew, cb),
  onDeepLink: (cb: (url: string) => void): (() => void) => subscribe(IPC.deepLink, cb),
  onOpenFile: (cb: (path: string) => void): (() => void) => subscribe(IPC.openFile, cb)
}

export type Api = typeof api
