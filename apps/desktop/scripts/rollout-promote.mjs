#!/usr/bin/env node
// Raises the rollout of the newest stable release step by step (see scripts/lib/promote.mjs),
// as long as the rollout guard says it is healthy. Runs after the guard in rollout-guard.yml.
//
// Env: GH_TOKEN, GITHUB_REPOSITORY, GUARD_VERDICT (healthy | paused | unknown),
//      AUTO_PROMOTE_WITHOUT_CRASH_DATA ("true" to promote on age alone when there is no crash data).
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { nextRollout } from './lib/promote.mjs'
import { readRollout, withRollout } from './lib/rollout.mjs'

const {
  GITHUB_REPOSITORY,
  GUARD_VERDICT = 'unknown',
  AUTO_PROMOTE_WITHOUT_CRASH_DATA
} = process.env
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8' })
const repoArgs = ['--repo', GITHUB_REPOSITORY]

const newest = JSON.parse(
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
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0]

if (!newest) {
  console.log('No stable release yet.')
  process.exit(0)
}

const dir = mkdtempSync(join(tmpdir(), 'promote-'))
gh('release', 'download', newest.tagName, ...repoArgs, '--dir', dir, '--pattern', '*.yml')
const manifests = readdirSync(dir)
  .filter((f) => f.endsWith('.yml'))
  .map((f) => join(dir, f))

// All manifests of a release carry the same percentage; if they differ, use the lowest.
const current = Math.min(...manifests.map((file) => readRollout(readFileSync(file, 'utf8'))))
const ageHours = (Date.now() - new Date(newest.publishedAt).getTime()) / 3_600_000

const { percent, reason } = nextRollout({
  ageHours,
  current,
  verdict: GUARD_VERDICT,
  allowWithoutData: AUTO_PROMOTE_WITHOUT_CRASH_DATA === 'true'
})
console.log(`${newest.tagName} (guard: ${GUARD_VERDICT}): ${reason}`)
if (percent === null) process.exit(0)

for (const file of manifests) writeFileSync(file, withRollout(readFileSync(file, 'utf8'), percent))
gh('release', 'upload', newest.tagName, ...manifests, '--clobber', ...repoArgs)
console.log(`Rollout of ${newest.tagName} is now ${percent}%.`)
