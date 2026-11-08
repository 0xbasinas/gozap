#!/usr/bin/env node
// "Catch up": runs on a schedule (.github/workflows/catch-up.yml) and fixes what a merge made by a bot leaves undone.
//
// GitHub starts no workflows for anything done with GITHUB_TOKEN, and the auto-merge job merges that way. So such a merge
// gets no release, no deploy and no branch clean-up. This script looks at `main` and:
//   1. starts "Publish stable release" and "Deploy web and API" by hand (workflow_dispatch, which GITHUB_TOKEN may do)
//      when a recent commit should have started them and no run covers it;
//   2. deletes merged pull request branches that are still there and unchanged since the merge.
// It does nothing when everything is already as it should be. `--dry-run` only says what it would do.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { branchesToDelete, needsStart, newestTrigger, readPushPaths } from './catch-up-lib.mjs'

const dryRun = process.argv.includes('--dry-run')
const defaultBranch = process.env.DEFAULT_BRANCH ?? 'main'

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0 && !allowFail)
    throw new Error(`${cmd} ${args.join(' ')} failed:\n${r.stderr || r.stdout}`)
  return { ok: r.status === 0, out: (r.stdout ?? '').trim() }
}
const git = (...a) => run('git', a).out
const gh = (...a) => run('gh', a).out

const now = Math.floor(Date.now() / 1000)
const ref = `origin/${defaultBranch}`

// Recent commits on the default branch with the files each changed, newest first.
const commits = git('log', ref, '--since=3.days', '--format=%H\t%ct')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [sha, time] = line.split('\t')
    const files = git('diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha)
      .split('\n')
      .filter(Boolean)
    return { sha, time: Number(time), files }
  })

const workflows = [
  { file: 'publish-stable.yml', label: 'release', enabled: true },
  // Deploys are off until the repository variable CLOUDFLARE_DEPLOY is true.
  { file: 'deploy-web.yml', label: 'deploy', enabled: process.env.CLOUDFLARE_DEPLOY === 'true' }
]

for (const { file, label, enabled } of workflows) {
  if (!enabled) {
    console.log(`${label}: switched off, skipping.`)
    continue
  }
  const paths = readPushPaths(readFileSync(`.github/workflows/${file}`, 'utf8'))
  const commit = newestTrigger(commits, paths)
  if (!commit) {
    console.log(`${label}: no recent commit needs one.`)
    continue
  }
  const runs = JSON.parse(
    gh(
      'run',
      'list',
      '--workflow',
      file,
      '--branch',
      defaultBranch,
      '--limit',
      '40',
      '--json',
      'headSha'
    )
  )
  // A run covers the commit when it is for that commit or a later one.
  const runsCover = runs.some(
    (r) =>
      r.headSha === commit.sha ||
      run('git', ['merge-base', '--is-ancestor', commit.sha, r.headSha], { allowFail: true }).ok
  )
  if (!needsStart({ commit, now, runsCover })) {
    console.log(
      `${label}: ${commit.sha.slice(0, 7)} ${runsCover ? 'is covered by a run' : 'is too new to judge'}.`
    )
    continue
  }
  console.log(
    `${label}: ${commit.sha.slice(0, 7)} should have started ${file} but nothing did. Starting it.`
  )
  if (!dryRun) gh('workflow', 'run', file, '--ref', defaultBranch)
}

// Merged pull request branches that were not deleted.
const pulls = JSON.parse(
  gh(
    'pr',
    'list',
    '--state',
    'merged',
    '--limit',
    '50',
    '--json',
    'headRefName,headRefOid,isCrossRepository'
  )
)
const branches = new Map(
  git('ls-remote', '--heads', 'origin')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, name] = line.split('\t')
      return [name.replace('refs/heads/', ''), sha]
    })
)
const stale = branchesToDelete({ pulls, branches, defaultBranch })
if (stale.length === 0) console.log('branches: nothing to delete.')
for (const name of stale) {
  console.log(`branches: deleting ${name} (merged and unchanged).`)
  if (!dryRun) run('git', ['push', 'origin', '--delete', name], { allowFail: true })
}
