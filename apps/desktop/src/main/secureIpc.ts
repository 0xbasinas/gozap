import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { isTrustedUrl } from './trust'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

/**
 * Register an IPC handler that only answers the app's own top-level page.
 * Payloads arrive as `unknown`: validate them (see src/shared/validate.ts) before using them.
 */
export function handle(channel: string, handler: Handler): void {
  ipcMain.handle(channel, (event, ...args) => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame || !isTrustedUrl(frame.url)) {
      throw new Error(`Rejected IPC "${channel}" from an untrusted sender`)
    }
    return handler(event, ...args)
  })
}
