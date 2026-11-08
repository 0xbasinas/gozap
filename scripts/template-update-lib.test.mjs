import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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
  touchesRelease
} from './template-update-lib.mjs'

const A = 'a'.repeat(40)
const B = 'b'.repeat(40)

test('parseConfig fills defaults and checks the base', () => {
  assert.deepEqual(parseConfig(JSON.stringify({ base: A })), {
    upstream: '0xbasinas/electron-desktop-template',
    base: A,
    ignore: []
  })
  assert.deepEqual(
    parseConfig(JSON.stringify({ upstream: 'me/tpl', base: A, ignore: ['docs/**'] })),
    {
      upstream: 'me/tpl',
      base: A,
      ignore: ['docs/**']
    }
  )
  assert.throws(() => parseConfig('nope'), /not valid JSON/)
  assert.throws(() => parseConfig('[]'), /must be an object/)
  assert.throws(() => parseConfig(JSON.stringify({ base: 'main' })), /40-character/)
  assert.throws(
    () => parseConfig(JSON.stringify({ base: A, upstream: 'not a repo' })),
    /owner\/repo/
  )
  assert.throws(() => parseConfig(JSON.stringify({ base: A, ignore: 'x' })), /list/)
})

test('parseConfig refuses ignore patterns that could escape or become git options', () => {
  for (const bad of [':(top)x', '/etc/passwd', '../x', 'a/../b', '']) {
    assert.throws(() => parseConfig(JSON.stringify({ base: A, ignore: [bad] })), /ignore/)
  }
})

test('serializeConfig round trips', () => {
  const config = { upstream: 'me/tpl', base: B, ignore: ['x'] }
  assert.deepEqual(parseConfig(serializeConfig(config)), config)
})

test('excludePathspecs always protect the app-owned files', () => {
  const specs = excludePathspecs(['docs/**'])
  assert.ok(specs.includes(':(exclude,glob)pnpm-lock.yaml'))
  assert.ok(specs.includes(':(exclude,glob).template.json'))
  assert.ok(specs.includes(':(exclude,glob)docs/**'))
})

test('isIgnored understands *, ** and folders', () => {
  const p = ['README.md', 'docs/**', 'apps/web/public/', 'src/*.txt']
  assert.equal(isIgnored('README.md', p), true)
  assert.equal(isIgnored('docs/a/b.md', p), true)
  assert.equal(isIgnored('apps/web/public/logo.svg', p), true)
  assert.equal(isIgnored('src/a.txt', p), true)
  assert.equal(isIgnored('src/deep/a.txt', p), false)
  assert.equal(isIgnored('apps/web/src/App.tsx', p), false)
  assert.equal(isIgnored('READMEXmd', p), false)
})

test('pickBase chooses the closest commit, the newest on a tie', () => {
  assert.deepEqual(
    pickBase([
      { sha: A, changed: 30 },
      { sha: B, changed: 10 }
    ]),
    { sha: B, changed: 10 }
  )
  assert.deepEqual(
    pickBase([
      { sha: A, changed: 5 },
      { sha: B, changed: 5 }
    ]),
    { sha: A, changed: 5 }
  )
  assert.equal(pickBase([]), null)
  assert.equal(
    pickBase([
      { sha: 'short', changed: 1 },
      { sha: A, changed: Number.NaN }
    ]),
    null
  )
})

test('countChanged adds up numstat lines, counting binary files once', () => {
  assert.equal(countChanged('1\t2\ta.txt\n10\t0\tb.txt\n-\t-\tc.png\n'), 14)
  assert.equal(countChanged(''), 0)
})

test('parseNameStatus splits renames into a delete and an add', () => {
  const out = 'M\0a.txt\0A\0b.txt\0D\0c.txt\0R100\0old.txt\0new.txt\0'
  assert.deepEqual(parseNameStatus(out), [
    { status: 'M', path: 'a.txt' },
    { status: 'A', path: 'b.txt' },
    { status: 'D', path: 'c.txt' },
    { status: 'D', path: 'old.txt' },
    { status: 'A', path: 'new.txt' }
  ])
  assert.deepEqual(parseNameStatus(''), [])
})

test('classifyApply tells clean, conflicting and failed patches apart', () => {
  assert.equal(classifyApply({ status: 0, output: "Applied patch to 'a' cleanly." }), 'clean')
  assert.equal(
    classifyApply({ status: 1, output: "Applied patch to 'a' with conflicts." }),
    'conflict'
  )
  assert.equal(classifyApply({ status: 1, output: 'error: a: does not exist in index' }), 'failed')
})

test('touchesRelease spots changes that publish a release', () => {
  assert.equal(touchesRelease(['apps/desktop/src/main/index.ts']), true)
  assert.equal(touchesRelease(['apps/desktop/package.json']), true)
  assert.equal(touchesRelease(['docs/api.md', 'apps/web/src/App.tsx']), false)
})

test('names and the pull request text', () => {
  assert.equal(branchName(A), 'template-update/aaaaaaa')
  assert.equal(commitTitle(A, B), 'chore: update from the template (aaaaaaa..bbbbbbb)')
  const body = pullRequestBody({
    upstream: 'me/tpl',
    base: A,
    head: B,
    clean: ['a.ts'],
    conflicts: ['b.ts'],
    failed: ['c.ts'],
    ignored: ['README.md'],
    release: true,
    commits: ['feat: x']
  })
  assert.match(body, /Conflicts to resolve: 1/)
  assert.match(body, /`b\.ts`/)
  assert.match(body, /Could not apply/)
  assert.match(body, /Left alone \(1\)/)
  assert.match(body, /publishes a release/)
  assert.match(body, /feat: x/)
  const quiet = pullRequestBody({
    upstream: 'me/tpl',
    base: A,
    head: B,
    clean: [],
    conflicts: [],
    failed: [],
    ignored: [],
    release: false,
    commits: []
  })
  assert.doesNotMatch(quiet, /publishes a release|### Conflicts/)
})
