// pnpm admin:grant <email> [admin|support]   |   pnpm admin:revoke <email>
// Local database by default; add --remote for the real one. The person must already have signed in once.
import { roleSql } from './admin-lib.mjs'
import { runSql } from './run-sql.mjs'

const argv = process.argv.slice(2)
const remote = argv.includes('--remote')
const [command, email, role] = argv.filter((a) => a !== '--remote')
let sql
try {
  sql = roleSql(command, email, role)
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
process.exit(runSql(sql, remote))
