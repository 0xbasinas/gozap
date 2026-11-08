// pnpm seed:dev [--users N]
// Fills the LOCAL D1 database (the one `pnpm --filter @repo/api dev` uses) with fake people and preferences.
// It never touches the real database: it only ever runs wrangler with --local.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSeedSql, fakeUsers, parseArgs } from './seed-dev-lib.mjs'

function run(args) {
  const result = spawnSync('pnpm', ['--filter', '@repo/api', 'exec', 'wrangler', ...args], {
    stdio: 'inherit',
    shell: process.platform === 'win32'
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

try {
  const { users } = parseArgs(process.argv.slice(2))
  const dir = mkdtempSync(join(tmpdir(), 'seed-dev-'))
  const file = join(dir, 'seed.sql')
  writeFileSync(file, buildSeedSql(fakeUsers(users)))
  try {
    // Make sure the tables exist, then insert.
    run(['d1', 'migrations', 'apply', 'DB', '--local'])
    run(['d1', 'execute', 'DB', '--local', '--file', file])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  console.log(`Seeded ${users} fake people (person1@example.test ...) into the local database.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
