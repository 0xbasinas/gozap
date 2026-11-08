#!/usr/bin/env node
// Print release notes (Markdown) for a tag, grouped by Conventional Commit type.
// Usage: node scripts/release-notes.mjs <tag> [stable|beta]
// Covers the commits since the previous release on the same channel
// (stable: previous stable tag; beta: previous tag of any kind).
import { execFileSync } from 'node:child_process'

const [tag, channel = 'stable'] = process.argv.slice(2)
if (!tag) {
  console.error('Usage: node scripts/release-notes.mjs <tag> [stable|beta]')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

let previous = ''
try {
  const exclude = channel === 'stable' ? ['--exclude', '*-beta'] : []
  previous = git('describe', '--tags', '--abbrev=0', '--match', 'v*', ...exclude, `${tag}^`)
} catch {
  // First release: include everything.
}

const repoUrl = process.env.GITHUB_REPOSITORY
  ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}`
  : ''

const range = previous ? `${previous}..${tag}` : tag
const raw = git('log', range, '--no-merges', '--format=%h%x1f%s%x1f%b%x1e')

const SECTIONS = [
  ['breaking', 'Breaking changes'],
  ['feat', 'Features'],
  ['fix', 'Bug fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Refactoring'],
  ['docs', 'Documentation'],
  ['maintenance', 'Maintenance'],
  ['other', 'Other changes']
]
const MAINTENANCE = new Set(['build', 'ci', 'chore', 'test', 'style', 'revert'])
const groups = Object.fromEntries(SECTIONS.map(([key]) => [key, []]))

const header = /^(\w+)(?:\(([^)]+)\))?(!)?: (.+)$/

for (const record of raw.split('\x1e')) {
  const [hash, subject, body = ''] = record.trim().split('\x1f')
  if (!hash || !subject) continue

  const match = subject.match(header)
  const type = match?.[1]
  const scope = match?.[2]
  const text = match ? match[4] : subject
  const line = `- ${scope ? `**${scope}:** ` : ''}${text}${
    repoUrl ? ` ([\`${hash}\`](${repoUrl}/commit/${hash}))` : ` (\`${hash}\`)`
  }`

  const breaking = Boolean(match?.[3]) || /^BREAKING[ -]CHANGE:/m.test(body)
  if (breaking) groups.breaking.push(line)

  if (type === 'feat' || type === 'fix' || type === 'perf' || type === 'refactor') {
    if (!breaking) groups[type].push(line)
  } else if (type === 'docs') {
    groups.docs.push(line)
  } else if (type && MAINTENANCE.has(type)) {
    groups.maintenance.push(line)
  } else if (!breaking) {
    groups.other.push(line)
  }
}

const out = [`## What's changed`, '']
let any = false
for (const [key, title] of SECTIONS) {
  if (!groups[key].length) continue
  any = true
  out.push(`### ${title}`, '', ...groups[key], '')
}
if (!any) out.push('No user-facing changes.', '')
if (previous && repoUrl) {
  out.push(
    `**Full changelog:** [${previous}...${tag}](${repoUrl}/compare/${previous}...${tag})`,
    ''
  )
}
console.log(out.join('\n'))
