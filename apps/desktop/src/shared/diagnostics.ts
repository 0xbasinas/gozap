// Builds the text of the diagnostics report. Pure (no Electron), so it is unit tested.

export interface DiagnosticsInput {
  app: { name: string; version: string; packaged: boolean }
  system: { platform: string; arch: string; osVersion: string; locale: string }
  versions: { electron: string; chrome: string; node: string }
  gpu: Record<string, string>
  memoryMB: { rss: number; heapUsed: number }
  settings: Record<string, string | number | boolean>
  logPath: string
  logTail: string
}

/** Replace the user's home folder with "~", so a pasted report does not reveal their account name. */
export function redactHome(text: string, home: string): string {
  if (!home) return text
  const variants = new Set([home, home.replaceAll('\\', '/'), home.replaceAll('\\', '\\\\')])
  let out = text
  for (const variant of variants) out = out.split(variant).join('~')
  return out
}

/** The last `maxLines` lines of a log, dropping the first line when the log was cut mid-line. */
export function tailLines(text: string, maxLines: number, cutMidLine = false): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  if (cutMidLine) lines.shift()
  return lines.slice(-maxLines).join('\n').trim()
}

function section(title: string, rows: Record<string, string | number | boolean>): string {
  const body = Object.entries(rows).map(([key, value]) => `${key}: ${value}`)
  return [`## ${title}`, ...body].join('\n')
}

/** The report the user can copy into a bug report: no account details, home folder replaced by "~". */
export function buildReport(input: DiagnosticsInput, home: string): string {
  const parts = [
    `# ${input.app.name} diagnostics`,
    section('App', {
      version: input.app.version,
      installed: input.app.packaged ? 'yes' : 'no (development)'
    }),
    section('System', { ...input.system }),
    section('Versions', { ...input.versions }),
    section('GPU', Object.keys(input.gpu).length ? input.gpu : { status: 'not available' }),
    section('Memory (MB)', { ...input.memoryMB }),
    section('Settings', input.settings),
    `## Log (last lines of ${input.logPath})`,
    input.logTail || '(empty)'
  ]
  return redactHome(parts.join('\n\n'), home)
}
