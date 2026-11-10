#!/usr/bin/env node
// `pnpm template:update`: brings the template's newer changes into an app that was made from it, as a pull request.
//
//   pnpm template:update              fetch the template, apply what changed since .template.json's "base", open a PR
//   pnpm template:update --check      only say how far behind the template this app is (exit 1 when behind)
//   pnpm template:update --adopt      first time: work out which template commit this app was made from, write .template.json
//   options: --ref <branch|tag|sha>  update to this instead of the template's default branch
//            --no-pr                 make the branch and commit, but do not push or open a PR
//            --no-install            skip `pnpm install` (which refreshes pnpm-lock.yaml)
//
// How it works: git can merge two trees that share a base, even in an unrelated repo, as long as it has all three
// objects. So we fetch the template, take the diff between the commit we last synced (base) and its newest commit,
// and apply it file by file with a 3-way merge against this app's own files. See docs/guides/template-updates.md.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import {
  CONFIG_PATH,
  DEFAULT_IGNORE,
  DEFAULT_UPSTREAM,
  branchName,
  classifyApply,
  commitTitle,
  countChanged,
  excludePathspecs,
  isIgnored,
  parseConfig,
  parseNameStatus,
  pickBase,
  pullRequestBody,
  serializeConfig,
  short,
  touchesRelease
} from './template-update-lib.mjs'

const isWindows = process.platform === 'win32'
const args = process.argv.slice(2)
const has = (name) => args.includes(`--${name}`)
const value = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? undefined : args[i + 1]
}

function run(cmd, cmdArgs, { input, allowFail = false } = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    input,
    // pnpm is a .cmd file on Windows and needs a shell; git and gh are real programs, so their arguments (a PR body
    // with newlines and quotes) go through untouched.
    shell: isWindows && cmd === 'pnpm',
    maxBuffer: 256 * 1024 * 1024
  })
  const out = r.stdout ?? ''
  const err = r.stderr ?? ''
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed:\n${err || out}`.trim())
  }
  return { status: r.status ?? 1, out, err }
}
const git = (...a) => run('git', a).out.trim()
const fail = (message) => {
  console.error(`\n${message}\n`)
  process.exit(1)
}

// --- Preconditions -----------------------------------------------------------------------------------------------
if (run('git', ['rev-parse', '--is-inside-work-tree'], { allowFail: true }).status !== 0) {
  fail('This is not a git repository.')
}
process.chdir(git('rev-parse', '--show-toplevel'))

if (!has('check') && run('git', ['status', '--porcelain']).out.trim() !== '') {
  fail(
    'You have uncommitted changes. Commit or stash them first, so the update lands on its own branch.'
  )
}

const upstreamArg = value('upstream')

/** Fetch the template (all of its history, so the base commit is there) and return the commit we are updating to. */
function fetchUpstream(upstream, ref) {
  const url = /^[a-z]+:\/\/|^git@/.test(upstream) ? upstream : `https://github.com/${upstream}.git`
  console.log(`Fetching ${url} ...`)
  run('git', ['fetch', '--no-tags', '--quiet', url, ref ?? 'HEAD'])
  return git('rev-parse', 'FETCH_HEAD')
}

// --- --adopt: find the template commit this app came from --------------------------------------------------------
if (has('adopt')) {
  if (existsSync(CONFIG_PATH) && !has('force')) {
    fail(`${CONFIG_PATH} already exists. Delete it or pass --force to work it out again.`)
  }
  const upstream = upstreamArg ?? DEFAULT_UPSTREAM
  const head = fetchUpstream(upstream, value('ref'))
  const explicit = value('base')
  let base
  if (explicit) {
    base = git('rev-parse', '--verify', `${explicit}^{commit}`)
  } else {
    const limit = Number(value('depth') ?? 200)
    console.log(
      `Comparing this app with the last ${limit} template commits to find the one it came from ...`
    )
    const shas = git('rev-list', `--max-count=${limit}`, head).split('\n').filter(Boolean)
    const exclude = excludePathspecs([])
    const candidates = shas.map((sha) => ({
      sha,
      // Compare the working tree with that template commit, leaving out what the app owns anyway.
      changed: countChanged(run('git', ['diff', '--numstat', sha, '--', '.', ...exclude]).out)
    }))
    const best = pickBase(candidates)
    if (!best) fail('Could not compare this app with the template.')
    base = best.sha
    console.log(`Closest match: ${short(base)} (${best.changed} lines differ).`)
    if (best.changed > 5000) {
      console.log(
        'That is a lot of difference: this app has moved far from the template. Check the result, or pass --base <sha> if you know it.'
      )
    }
  }
  writeFileSync(CONFIG_PATH, serializeConfig({ upstream, base, ignore: [] }))
  console.log(`\nWrote ${CONFIG_PATH}. Commit it, then run: pnpm template:update`)
  process.exit(0)
}

// --- Normal run --------------------------------------------------------------------------------------------------
if (!existsSync(CONFIG_PATH)) {
  fail(
    `There is no ${CONFIG_PATH}, so I do not know which template version this app is based on.\nRun once: pnpm template:update --adopt`
  )
}
let config
try {
  config = parseConfig(readFileSync(CONFIG_PATH, 'utf8'))
} catch (error) {
  fail(error.message)
}

const head = fetchUpstream(config.upstream, value('ref'))
if (run('git', ['cat-file', '-e', `${config.base}^{commit}`], { allowFail: true }).status !== 0) {
  fail(
    `The commit ${short(config.base)} in ${CONFIG_PATH} is not in ${config.upstream} (was history rewritten?).\nRun: pnpm template:update --adopt --force`
  )
}

const behind = Number(git('rev-list', '--count', `${config.base}..${head}`))
if (config.base === head || behind === 0) {
  console.log(`Up to date with ${config.upstream} (${short(head)}).`)
  process.exit(0)
}
console.log(
  `${behind} template commit${behind === 1 ? '' : 's'} to bring in (${short(config.base)}..${short(head)}).`
)
if (has('check')) process.exit(1)

// What changed in the template, split into what we may touch and what the app owns.
const patterns = [...new Set([...DEFAULT_IGNORE, ...config.ignore])]
const changed = parseNameStatus(
  run('git', ['diff', '--no-renames', '--name-status', '-z', config.base, head]).out
)
const ignored = changed.filter((f) => isIgnored(f.path, patterns)).map((f) => f.path)
const todo = changed.filter((f) => !isIgnored(f.path, patterns))
if (todo.length === 0) {
  console.log('Nothing in the template changed outside the files you own.')
  // Still move the base forward, so the next run does not look at these commits again.
}

const commits = git('log', '--no-merges', '--format=%s', `${config.base}..${head}`)
  .split('\n')
  .filter(Boolean)

const branch = branchName(head)
const startBranch = git('rev-parse', '--abbrev-ref', 'HEAD')
run('git', ['checkout', '-b', branch])

const clean = []
const conflicts = []
const failed = []
for (const file of todo) {
  const patch = run('git', [
    'diff',
    '--no-renames',
    '--binary',
    '--full-index',
    config.base,
    head,
    '--',
    file.path
  ]).out
  const result = run('git', ['apply', '--3way', '--whitespace=nowarn'], {
    input: patch,
    allowFail: true
  })
  const outcome = classifyApply({ status: result.status, output: `${result.out}\n${result.err}` })
  ;(outcome === 'clean' ? clean : outcome === 'conflict' ? conflicts : failed).push(file.path)
}

writeFileSync(CONFIG_PATH, serializeConfig({ ...config, base: head }))
if (
  !has('no-install') &&
  clean.concat(conflicts).some((f) => f.endsWith('package.json') || f === 'pnpm-workspace.yaml')
) {
  console.log('Dependencies changed: running pnpm install to refresh pnpm-lock.yaml ...')
  const install = run('pnpm', ['install', '--no-frozen-lockfile'], { allowFail: true })
  if (install.status !== 0)
    console.log(`pnpm install failed (fix it on the branch):\n${install.err}`)
}

run('git', ['add', '-A'])
run('git', ['commit', '-m', commitTitle(config.base, head)], { allowFail: true })

const touched = clean.concat(conflicts)
console.log(
  `\nApplied cleanly: ${clean.length}   Conflicts: ${conflicts.length}   Could not apply: ${failed.length}   Left alone: ${ignored.length}`
)
for (const f of conflicts) console.log(`  conflict  ${f}`)
for (const f of failed) console.log(`  failed    ${f}`)

if (has('no-pr')) {
  console.log(
    `\nBranch ${branch} is ready (not pushed). Switch back with: git checkout ${startBranch}`
  )
  process.exit(0)
}

const body = pullRequestBody({
  upstream: config.upstream,
  base: config.base,
  head,
  clean,
  conflicts,
  failed,
  ignored,
  release: touchesRelease(touched),
  commits
})
run('git', ['push', '-u', 'origin', branch])
const pr = run(
  'gh',
  [
    'pr',
    'create',
    '--title',
    commitTitle(config.base, head),
    '--body',
    body,
    ...(conflicts.length || failed.length ? ['--draft'] : [])
  ],
  { allowFail: true }
)
if (pr.status !== 0)
  fail(`The branch ${branch} is pushed, but opening the pull request failed:\n${pr.err}`)
console.log(`\n${pr.out.trim()}`)
if (conflicts.length || failed.length) {
  console.log(
    'It is a draft because some files need you. Resolve them on the branch, then mark it ready.'
  )
}
