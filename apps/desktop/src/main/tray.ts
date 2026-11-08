import { app, clipboard, Menu, nativeImage, Tray, type BrowserWindow } from 'electron'
import icon from '../../resources/icon.png?asset'
import { getAccount, onAccountChanged, signOut } from './auth'
import { collectDiagnostics } from './diagnostics'
import { notify } from './notify'
import { revealLogs } from './logger'
import { getSettings, updateSettings } from './settings'
import { openSettingsWindow } from './settingsWindow'
import { requestUpdateCheck, requestWhatsNew, showWindow, toggleWindow } from './windowUtils'

// Keep a reference, otherwise the tray icon is garbage collected and disappears.
let tray: Tray | undefined
let getWindow: () => BrowserWindow | undefined = () => undefined
let signedIn = false

export function setupTray(windowGetter: () => BrowserWindow | undefined): void {
  getWindow = windowGetter
  try {
    const size = process.platform === 'darwin' ? 18 : 16
    tray = new Tray(nativeImage.createFromPath(icon).resize({ width: size, height: size }))
    tray.setToolTip(app.name)
    // Left click toggles the window on Windows. (On macOS a click opens the menu instead.)
    tray.on('click', () => withWindow(toggleWindow))
    refreshTrayMenu()
    // Offer "Sign out" only while someone is signed in.
    const track = (user: unknown): void => {
      signedIn = Boolean(user)
      refreshTrayMenu()
    }
    onAccountChanged((account) => track(account.user))
    void getAccount().then((account) => track(account.user))
  } catch (error) {
    // Some Linux desktops have no tray. The app works fine without one.
    console.warn('[tray] Could not create the tray icon', error)
  }
}

function withWindow(fn: (win: BrowserWindow) => void): void {
  const win = getWindow()
  if (win) fn(win)
}

/** Rebuild the tray menu so its checkbox matches the current settings. */
export function refreshTrayMenu(): void {
  if (!tray) return
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Show ${app.name}`, click: () => withWindow(showWindow) },
      { label: 'Check for Updates...', click: () => withWindow(requestUpdateCheck) },
      { label: 'Settings...', click: () => openSettingsWindow(getWindow()) },
      { label: "What's New", click: () => withWindow(requestWhatsNew) },
      { type: 'separator' },
      { label: 'Show Log File', click: () => revealLogs() },
      {
        label: 'Copy Diagnostics',
        click: () => {
          clipboard.writeText(collectDiagnostics())
          notify('Diagnostics copied', 'Paste the report into your bug report.')
        }
      },
      ...(signedIn ? [{ label: 'Sign Out', click: () => void signOut() }] : []),
      { type: 'separator' },
      {
        label: 'Keep running in the tray when closed',
        type: 'checkbox',
        checked: getSettings().closeToTray,
        // Windows and Linux only: on macOS apps already stay running after the window closes.
        visible: process.platform !== 'darwin',
        click: (item) => {
          updateSettings({ closeToTray: item.checked })
        }
      },
      { type: 'separator' },
      { label: 'Quit', role: 'quit' }
    ])
  )
}
