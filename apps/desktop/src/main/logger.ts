import { shell } from 'electron'
import log from 'electron-log/main'

/**
 * File logging. Call once, as early as possible. Afterwards `console.log/warn/error` in the main
 * process also go to the log file, and uncaught errors are recorded instead of silently lost.
 *
 * The log lives in: Windows %APPDATA%\<app>\logs, macOS ~/Library/Logs/<app>, Linux ~/.config/<app>/logs.
 */
export function setupLogging(): void {
  log.initialize()
  log.transports.file.maxSize = 2 * 1024 * 1024 // rotate at 2 MB
  log.errorHandler.startCatching({ showDialog: false })
  Object.assign(console, log.functions)
  log.info('--- app started ---')
}

export const logger = log

export function logFilePath(): string {
  return log.transports.file.getFile().path
}

/** Show the log file in Explorer / Finder / the file manager. */
export function revealLogs(): void {
  shell.showItemInFolder(logFilePath())
}
