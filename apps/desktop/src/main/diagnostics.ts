import { app } from 'electron'
import { closeSync, openSync, readSync, fstatSync } from 'fs'
import { arch, homedir, release, version as osVersion } from 'os'
import { buildReport, tailLines } from '../shared/diagnostics'
import { logFilePath } from './logger'
import { getSettings } from './settings'

const TAIL_BYTES = 16 * 1024
const TAIL_LINES = 60

/** The end of the log file (empty if it cannot be read). */
function readLogTail(path: string): string {
  try {
    const fd = openSync(path, 'r')
    try {
      const size = fstatSync(fd).size
      const length = Math.min(size, TAIL_BYTES)
      const buffer = Buffer.alloc(length)
      readSync(fd, buffer, 0, length, size - length)
      return tailLines(buffer.toString('utf8'), TAIL_LINES, size > length)
    } finally {
      closeSync(fd)
    }
  } catch {
    return ''
  }
}

/** Plain-text report for bug reports. It holds no account details, and the home folder is shown as "~". */
export function collectDiagnostics(): string {
  const gpu: Record<string, string> = {}
  try {
    for (const [key, value] of Object.entries(app.getGPUFeatureStatus())) gpu[key] = String(value)
  } catch {
    // Not available before the app is ready, or on some systems: the report says so.
  }
  const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024)
  const memory = process.memoryUsage()
  const logPath = logFilePath()
  return buildReport(
    {
      app: { name: app.getName(), version: app.getVersion(), packaged: app.isPackaged },
      system: {
        platform: process.platform,
        arch: arch(),
        osVersion: `${osVersion()} ${release()}`,
        locale: app.getLocale()
      },
      versions: {
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      gpu,
      memoryMB: { rss: mb(memory.rss), heapUsed: mb(memory.heapUsed) },
      settings: { ...getSettings() },
      logPath,
      logTail: readLogTail(logPath)
    },
    homedir()
  )
}
