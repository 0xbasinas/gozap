import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  branchesToDelete,
  needsStart,
  newestTrigger,
  pathsMatch,
  readPushPaths
} from './catch-up-lib.mjs'

const yaml = `name: x
on:
  push:
    branches: [main]
    paths:
      - 'apps/desktop/src/**'
      - '!apps/desktop/src/**/*.test.ts'
      - "pnpm-lock.yaml"
      - 'packages/**' # shared
  workflow_dispatch:
`

test('readPushPaths reads the paths list and stops at the end of it', () => {
  assert.deepEqual(readPushPaths(yaml), [
    'apps/desktop/src/**',
    '!apps/desktop/src/**/*.test.ts',
    'pnpm-lock.yaml',
    'packages/**'
  ])
  assert.deepEqual(readPushPaths('on:\n  push:\n    branches: [main]\n'), [])
  assert.deepEqual(readPushPaths(yaml.replaceAll('\n', '\r\n')).length, 4)
})

test('pathsMatch follows GitHub: ** crosses folders, later ! patterns exclude', () => {
  const paths = readPushPaths(yaml)
  assert.equal(pathsMatch(['apps/desktop/src/main/index.ts'], paths), true)
  assert.equal(pathsMatch(['apps/desktop/src/main/a.test.ts'], paths), false)
  assert.equal(pathsMatch(['pnpm-lock.yaml'], paths), true)
  assert.equal(pathsMatch(['docs/api.md', 'README.md'], paths), false)
  assert.equal(pathsMatch(['docs/api.md', 'packages/shared/src/a.ts'], paths), true)
  assert.equal(pathsMatch(['anything'], []), true)
})

test('newestTrigger picks the newest commit that should have started it', () => {
  const commits = [
    { sha: 'c', time: 30, files: ['docs/a.md'] },
    { sha: 'b', time: 20, files: ['apps/desktop/src/x.ts'] },
    { sha: 'a', time: 10, files: ['apps/desktop/src/y.ts'] }
  ]
  assert.equal(newestTrigger(commits, readPushPaths(yaml)).sha, 'b')
  assert.equal(newestTrigger([commits[0]], readPushPaths(yaml)), null)
})

test('needsStart waits for the normal trigger, and never repeats a run that exists', () => {
  const commit = { sha: 'a', time: 1000, files: [] }
  assert.equal(needsStart({ commit: null, now: 5000, runsCover: false }), false)
  assert.equal(needsStart({ commit, now: 1100, runsCover: false }), false) // too fresh
  assert.equal(needsStart({ commit, now: 1600, runsCover: false }), true)
  assert.equal(needsStart({ commit, now: 9000, runsCover: true }), false)
})

test('branchesToDelete only removes untouched, same-repo, non-default branches', () => {
  const pulls = [
    { headRefName: 'feat/a', headRefOid: '111', isCrossRepository: false },
    { headRefName: 'feat/moved', headRefOid: '222', isCrossRepository: false },
    { headRefName: 'feat/gone', headRefOid: '333', isCrossRepository: false },
    { headRefName: 'fork-branch', headRefOid: '444', isCrossRepository: true },
    { headRefName: 'main', headRefOid: '555', isCrossRepository: false }
  ]
  const branches = new Map([
    ['feat/a', '111'],
    ['feat/moved', '999'], // someone pushed again after the merge
    ['fork-branch', '444'],
    ['main', '555']
  ])
  assert.deepEqual(branchesToDelete({ pulls, branches, defaultBranch: 'main' }), ['feat/a'])
})
