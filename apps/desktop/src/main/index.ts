import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerAppScheme, serveRenderer } from './appProtocol'
import { setupCrashReporting, reportRendererCrash } from './crashReporting'
import { flushPending, initDeepLinks } from './deeplink'
import { registerIpcHandlers } from './ipcHandlers'
import { logger, setupLogging } from './logger'
import { setupMenu } from './menu'
import { getSettings } from './settings'
import { startPreferencesSync } from './preferencesSync'
import { setupSettingsEffects } from './settingsEffects'
import { setupShortcuts } from './shortcuts'
import { setupTray } from './tray'
import { setupAutoUpdater } from './updater'
import {
  hardenWindow,
  loadRenderer,
  secureWebPreferences,
  titleBarOptions,
  watchTheme
} from './windowChrome'
import { loadWindowState, trackWindowState } from './windowState'
import icon from '../../resources/icon.png?asset'

// The app:// scheme has to be declared before the app is ready.
registerAppScheme()

const isMac = process.platform === 'darwin'
let mainWindow: BrowserWindow | undefined
// Set when the app is really quitting, so "close to tray" doesn't block it.
let quitting = false

function createWindow(): void {
  const state = loadWindowState()
  const win = new BrowserWindow({
    width: state.width,
    height: state.height,
    x: state.x,
    y: state.y,
    minWidth: 480,
    minHeight: 360,
    show: false,
    autoHideMenuBar: true,
    ...titleBarOptions(),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: secureWebPreferences()
  })
  mainWindow = win
  if (state.isMaximized) win.maximize()
  trackWindowState(win)

  win.on('ready-to-show', () => win.show())
  win.on('close', (event) => {
    // Optional: closing the window keeps the app running in the tray (Windows and Linux).
    if (!quitting && !isMac && getSettings().closeToTray) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('closed', () => (mainWindow = undefined))
  win.webContents.on('did-finish-load', flushPending)
  win.webContents.on('render-process-gone', (_event, details) => {
    logger.error('[renderer] process gone', details)
    if (details.reason !== 'clean-exit') reportRendererCrash(details.reason)
  })

  hardenWindow(win)
  watchTheme(win)
  loadRenderer(win)
}

// Only one instance: a second launch (e.g. clicking a deep link) is forwarded to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  setupLogging()
  setupCrashReporting()
  initDeepLinks(() => mainWindow)
  app.on('before-quit', () => (quitting = true))

  app.whenReady().then(() => {
    serveRenderer()
    electronApp.setAppUserModelId('com.0xbasinas.electron-desktop-template')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    registerIpcHandlers()
    createWindow()
    setupMenu(() => mainWindow)
    setupTray(() => mainWindow)
    setupShortcuts(() => mainWindow)
    setupSettingsEffects()
    startPreferencesSync()
    setupAutoUpdater()

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Quit when all windows are closed, except on macOS, where apps stay active until Cmd + Q.
  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })
}
