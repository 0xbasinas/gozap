import { BrowserWindow } from 'electron'
import {
  hardenWindow,
  loadRenderer,
  secureWebPreferences,
  titleBarOptions,
  watchTheme
} from './windowChrome'
import { showWindow } from './windowUtils'

let settingsWindow: BrowserWindow | undefined

/** Open the settings window, or bring it forward if it is already open. */
export function openSettingsWindow(parent?: BrowserWindow): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    showWindow(settingsWindow)
    return
  }

  const win = new BrowserWindow({
    width: 560,
    height: 600,
    minWidth: 420,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    title: 'Settings',
    // Sits above the main window like a dialog, but can be moved around freely.
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    minimizable: false,
    maximizable: false,
    ...titleBarOptions(),
    webPreferences: secureWebPreferences()
  })
  settingsWindow = win

  win.on('ready-to-show', () => win.show())
  win.on('closed', () => (settingsWindow = undefined))
  hardenWindow(win)
  watchTheme(win)
  loadRenderer(win, 'settings')
}
