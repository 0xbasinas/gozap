// Runs one SQL statement on the API's D1 database through wrangler. The SQL goes through a temporary file, because
// passing it as an argument is split at the spaces by the Windows shell.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function runSql(sql, remote) {
  const dir = mkdtempSync(join(tmpdir(), 'd1-'))
  const file = join(dir, 'query.sql')
  writeFileSync(file, sql)
  try {
    const result = spawnSync(
      'pnpm',
      [
        '--filter',
        '@repo/api',
        'exec',
        'wrangler',
        'd1',
        'execute',
        'DB',
        remote ? '--remote' : '--local',
        '--file',
        file
      ],
      { stdio: 'inherit', shell: process.platform === 'win32' }
    )
    return result.status ?? 1
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
