import { APP_URL } from './appPath'
import { BrowserWindow, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { isTrustedUrl } from './trust'

const isMac = process.platform === 'darwin'

// Colors match --background in the renderer's theme so there is no white flash on startup.
export const backgroundColor = (): string =>
  nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff'

const overlay = (): Electron.TitleBarOverlayOptions => ({
  color: backgroundColor(),
  symbolColor: nativeTheme.shouldUseDarkColors ? '#fafafa' : '#0a0a0a',
  // One pixel shorter than the 40px title bar, so the bar's bottom border stays visible under the controls.
  height: 39
})

/** Custom title bar: the renderer draws it, the OS still provides the window controls. */
export function titleBarOptions(): BrowserWindowConstructorOptions {
  return {
    backgroundColor: backgroundColor(),
    titleBarStyle: 'hidden',
    ...(isMac ? { trafficLightPosition: { x: 14, y: 12 } } : { titleBarOverlay: overlay() })
  }
}

/** Web preferences every window uses. The renderer is sandboxed and has no Node access. */
export function secureWebPreferences(): Electron.WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false
  }
}

/** Load the renderer. `hash` picks the screen ("settings" opens the settings window). */
export function loadRenderer(win: BrowserWindow, hash = ''): void {
  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash ? `#${hash}` : ''}`)
  } else {
    win.loadURL(`${APP_URL}${hash ? `#${hash}` : ''}`)
  }
}

/** Colour the window itself and its controls for the current light/dark state, so nothing light shows through while the page repaints. */
export function syncWindowColors(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setBackgroundColor(backgroundColor())
  if (!isMac) win.setTitleBarOverlay(overlay())
}

/** Keep the window's colours in step when the system light/dark setting changes. */
export function watchTheme(win: BrowserWindow): void {
  const update = (): void => syncWindowColors(win)
  nativeTheme.on('updated', update)
  win.on('closed', () => nativeTheme.off('updated', update))
}

/** Stop a window from navigating anywhere except the app, and send links to the browser. */
export function hardenWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Only ever hand real web links to the OS. Anything else (file:, javascript:, custom schemes) is dropped.
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
}
