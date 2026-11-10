// Saves the current docs as a version: `pnpm --filter @repo/docs version:create <slug> [--label "1.0"]`.
// Copies /docs to /docs-versions/<slug> and adds the version to apps/docs/versions.json (newest first).
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkSlug } from './versions-lib.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const root = join(here, '../../..')
const configFile = join(here, '../versions.json')
const sections = JSON.parse(readFileSync(join(here, '../sidebar.json'), 'utf8'))

const args = process.argv.slice(2)
const slug = args.find((a) => !a.startsWith('--'))
const labelAt = args.indexOf('--label')
const label = labelAt >= 0 ? args[labelAt + 1] : slug

if (!slug) {
  console.error('Usage: pnpm --filter @repo/docs version:create <slug> [--label "1.0"]')
  process.exit(1)
}
const problem = checkSlug(slug, sections)
if (problem) {
  console.error(problem)
  process.exit(1)
}

const config = JSON.parse(readFileSync(configFile, 'utf8'))
const target = join(root, 'docs-versions', slug)
if (config.versions.some((v) => v.slug === slug) || existsSync(target)) {
  console.error(`Version "${slug}" already exists.`)
  process.exit(1)
}

cpSync(join(root, 'docs'), target, { recursive: true })
config.versions.unshift({ slug, label, redirect: 'same-page' })
writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
console.log(
  `Saved the current docs as "${label}" in docs-versions/${slug}. Commit it, then keep editing /docs for the next version.`
)
