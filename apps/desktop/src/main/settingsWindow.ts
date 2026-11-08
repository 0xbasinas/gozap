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

  // Show the window only once the page has filled in (it sets data-ready), so it does not flash empty and then jump.
  // The wait is capped, so a slow or failed load still opens the window.
  let shown = false
  const show = (): void => {
    if (shown || win.isDestroyed()) return
    shown = true
    win.show()
  }
  win.once('ready-to-show', () => {
    const ready = `new Promise((resolve) => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (document.documentElement.dataset.ready || Date.now() - started > 1500) {
          clearInterval(timer)
          resolve()
        }
      }, 16)
    })`
    win.webContents.executeJavaScript(ready).then(show, show)
  })
  setTimeout(show, 3000)
  win.on('closed', () => (settingsWindow = undefined))
  hardenWindow(win)
  watchTheme(win)
  loadRenderer(win, 'settings')
}
