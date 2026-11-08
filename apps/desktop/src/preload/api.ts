import { ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type Account,
  type AppInfo,
  type Settings,
  type UpdaterEvent,
  type WhatsNew
} from '../shared/ipc'

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

  // Account (sign in through the system browser)
  getAccount: (): Promise<Account> => ipcRenderer.invoke(IPC.accountGet),
  signIn: (): Promise<void> => ipcRenderer.invoke(IPC.accountSignIn),
  signOut: (): Promise<void> => ipcRenderer.invoke(IPC.accountSignOut),

  // First run and "what's new"
  getWhatsNew: (force = false): Promise<WhatsNew | undefined> =>
    ipcRenderer.invoke(IPC.whatsNewGet, force),
  markWhatsNewSeen: (): Promise<void> => ipcRenderer.invoke(IPC.whatsNewSeen),

  // Events from main
  onUpdaterEvent: (cb: (event: UpdaterEvent) => void): (() => void) =>
    subscribe(IPC.updaterEvent, cb),
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
