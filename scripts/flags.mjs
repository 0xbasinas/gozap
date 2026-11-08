// pnpm flags list | set <key> [--percent 25] [--channels beta] [--description "..."] | kill <key> | revive <key> | delete <key>
// Local database by default; add --remote for the real one. The kill switch reaches apps within ~5 minutes.
import { flagSql } from './flags-lib.mjs'
import { runSql } from './run-sql.mjs'

const argv = process.argv.slice(2)
const remote = argv.includes('--remote')
const rest = argv.filter((a) => a !== '--remote')
const [command, key] = rest
const args = {}
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) args[rest[i].slice(2)] = rest[++i]
}
let sql
try {
  sql = flagSql(command, key?.startsWith('--') ? undefined : key, args)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
process.exit(runSql(sql, remote))
