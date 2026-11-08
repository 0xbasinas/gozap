import { app, globalShortcut, type BrowserWindow } from 'electron'
import { toggleWindow } from './windowUtils'

/** Works from any app: show the window if it is hidden or behind others, hide it otherwise. */
export const TOGGLE_WINDOW_SHORTCUT = 'CommandOrControl+Shift+Space'

export function setupShortcuts(getWindow: () => BrowserWindow | undefined): void {
  const registered = globalShortcut.register(TOGGLE_WINDOW_SHORTCUT, () => {
    const win = getWindow()
    if (win) toggleWindow(win)
  })
  // Another app may already own the shortcut. That is not fatal, so just say so.
  if (!registered) console.warn(`[shortcuts] Could not register ${TOGGLE_WINDOW_SHORTCUT}`)

  app.on('will-quit', () => globalShortcut.unregisterAll())
}
