#!/usr/bin/env node
// Check (default) or fix (--write) the Worker's compatibility_date against the installed runtime (workerd).
// Exit code 1 from --check means "needs attention", so CI can report it.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { assess, readCompatDate, setCompatDate, workerdDate } from './compat-date-lib.mjs'

const CONFIG = 'apps/api/wrangler.jsonc'
const write = process.argv.includes('--write')

const dirs = readdirSync('node_modules/.pnpm').filter((d) => /^workerd@\d/.test(d))
if (dirs.length === 0) {
  console.error('workerd is not installed. Run pnpm install first.')
  process.exit(2)
}
const version = dirs
  .map((d) => d.slice('workerd@'.length).split('_')[0])
  .sort()
  .at(-1)
const config = readFileSync(CONFIG, 'utf8')
const result = assess({ configDate: readCompatDate(config), runtimeDate: workerdDate(version) })
console.log(result.message)

if (result.status === 'ok') process.exit(0)
if (write) {
  writeFileSync(CONFIG, setCompatDate(config, result.target))
  console.log(
    `Set compatibility_date to ${result.target}. Run pnpm --filter @repo/api types and the API tests, then open a PR.`
  )
  process.exit(0)
}
process.exit(1)
