import type { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc'

/** Bring the window to the front, even if it was minimized or hidden to the tray. */
export function showWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

/** Show the window if it is hidden or behind others, hide it if it is already in front. */
export function toggleWindow(win: BrowserWindow): void {
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    showWindow(win)
  }
}

/** Ask the renderer to run an update check, so the user sees the result in the banner. */
export function requestUpdateCheck(win: BrowserWindow): void {
  showWindow(win)
  win.webContents.send(IPC.menuCheckUpdates)
}

/** Ask the renderer to open the "what's new" screen for the current version. */
export function requestWhatsNew(win: BrowserWindow): void {
  showWindow(win)
  win.webContents.send(IPC.menuWhatsNew)
}
