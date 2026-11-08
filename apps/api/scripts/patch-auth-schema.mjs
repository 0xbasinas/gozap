// Runs after `auth generate` (see the auth:schema script). Better Auth writes an ordinary index on the API key hash;
// two keys must never share a hash, so this makes it unique. Safe to run twice.
import { readFileSync, writeFileSync } from 'node:fs'

const file = new URL('../src/db/auth-schema.ts', import.meta.url)
let text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n')

if (!text.includes('uniqueIndex("apikey_key_idx")')) {
  if (!text.includes('index("apikey_key_idx")'))
    throw new Error('apikey_key_idx not found in auth-schema.ts')
  text = text.replace('index("apikey_key_idx")', 'uniqueIndex("apikey_key_idx")')
}
if (!/import \{[^}]*\buniqueIndex\b[^}]*\} from "drizzle-orm\/sqlite-core"/.test(text)) {
  text = text.replace(
    /import \{ ([^}]*) \} from "drizzle-orm\/sqlite-core"/,
    'import { $1, uniqueIndex } from "drizzle-orm/sqlite-core"'
  )
}
writeFileSync(file, text)
console.log('auth-schema.ts: apikey_key_idx is unique')
