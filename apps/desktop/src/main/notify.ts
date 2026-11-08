import { BrowserWindow, Notification } from 'electron'
import { getSettings } from './settings'
import { showWindow } from './windowUtils'

/** Show a native notification, unless the user turned them off or the system cannot show them. Clicking it brings the window forward. */
export function notify(title: string, body: string): void {
  if (!getSettings().notifications || !Notification.isSupported()) return
  const notification = new Notification({ title, body })
  notification.on('click', () => {
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) showWindow(win)
  })
  notification.show()
}
