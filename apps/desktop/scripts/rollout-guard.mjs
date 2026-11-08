#!/usr/bin/env node
// Looks at crash data for the newest stable release and, if it is crashing, stops offering it (0% rollout)
// and opens an issue. Runs on a schedule from .github/workflows/rollout-guard.yml.
//
// Needs: SENTRY_AUTH_TOKEN (scope: org:read, project:read), SENTRY_ORG (slug), SENTRY_PROJECT (numeric id),
// plus the GitHub CLI (`gh`) with GH_TOKEN. Without the Sentry values it does nothing.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decide, parseSessions } from './lib/guard.mjs'
import { readRollout, withRollout } from './lib/rollout.mjs'

const { SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT, GITHUB_REPOSITORY } = process.env
const MAX_AGE_DAYS = 7 // a release older than this is no longer "new", so the guard leaves it alone

// Tell the next workflow step what we found: healthy, paused or unknown (not enough data).
function finish(verdict) {
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `verdict=${verdict}
`
    )
  process.exit(0)
}

if (!SENTRY_AUTH_TOKEN || !SENTRY_ORG || !SENTRY_PROJECT) {
  console.log(
    'Rollout guard is not configured (SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_PROJECT). Skipping.'
  )
  finish('unknown')
}

const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })
const repoArgs = ['--repo', GITHUB_REPOSITORY]

async function sessionsFor(version) {
  const query = encodeURIComponent(`release:${version}`)
  const url =
    `https://sentry.io/api/0/organizations/${SENTRY_ORG}/sessions/?project=${SENTRY_PROJECT}` +
    `&field=sum(session)&field=crash_free_rate(session)&statsPeriod=7d&query=${query}`
  const response = await fetch(url, { headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` } })
  if (!response.ok) throw new Error(`Sentry returned ${response.status} for ${version}`)
  return parseSessions(await response.json())
}

// The two newest published stable releases: the one being rolled out, and the one before it.
const releases = JSON.parse(
  gh(
    'release',
    'list',
    ...repoArgs,
    '--limit',
    '10',
    '--json',
    'tagName,isPrerelease,isDraft,publishedAt'
  )
)
  .filter((r) => !r.isPrerelease && !r.isDraft)
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

const [newest, before] = releases
if (!newest) {
  console.log('No stable release yet.')
  finish('unknown')
}

const ageDays = (Date.now() - new Date(newest.publishedAt).getTime()) / 86_400_000
if (ageDays > MAX_AGE_DAYS) {
  console.log(`${newest.tagName} is ${ageDays.toFixed(1)} days old; not guarding it.`)
  finish('unknown')
}

const version = (tag) => tag.replace(/^v/, '')
const current = await sessionsFor(version(newest.tagName))
const previous = before ? await sessionsFor(version(before.tagName)) : null
const { pause, verdict, reason } = decide(current, previous)
console.log(`${newest.tagName}: ${reason}`)
if (!pause) finish(verdict)

// Pause: set every manifest to 0%, unless that has already been done.
const dir = mkdtempSync(join(tmpdir(), 'guard-'))
gh('release', 'download', newest.tagName, ...repoArgs, '--dir', dir, '--pattern', '*.yml')
const manifests = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((f) => join(dir, f))

if (manifests.every((file) => readRollout(readFileSync(file, 'utf8')) === 0)) {
  console.log('Already paused.')
  finish('paused')
}
for (const file of manifests) writeFileSync(file, withRollout(readFileSync(file, 'utf8'), 0))
gh('release', 'upload', newest.tagName, ...manifests, '--clobber', ...repoArgs)

gh(
  'issue',
  'create',
  ...repoArgs,
  '--title',
  `Rollout of ${newest.tagName} paused automatically`,
  '--body',
  `${reason}\n\nThe release is now offered to 0% of users. Installs that already updated keep it.\n\n` +
    `- Looks like a false alarm: run **Actions > Set release rollout** to raise it again.\n` +
    `- Really broken: run **Actions > Rollback release** for ${newest.tagName}, then ship a fix.`
)
console.log(`Paused ${newest.tagName}.`)
finish('paused')
