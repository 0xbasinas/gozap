// Puts the built docs site into the built web app, at /docs, so the Worker serves both from one folder
// (apps/api/wrangler.jsonc serves apps/web/dist). Run after both are built: `pnpm build:site` does all of it.
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const docs = join(repo, 'apps/docs/dist')
const web = join(repo, 'apps/web/dist')

for (const [name, folder] of [
  ['the docs site', docs],
  ['the web app', web]
]) {
  if (!existsSync(folder)) {
    console.error(`Build ${name} first (missing ${folder}). \`pnpm build:site\` builds both.`)
    process.exit(1)
  }
}
rmSync(join(web, 'docs'), { recursive: true, force: true })
cpSync(docs, join(web, 'docs'), { recursive: true })
console.log('site: docs copied to apps/web/dist/docs')
