import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findDescription, findTitle, rewriteLinks, stripTitle, toPage } from './sync-lib.mjs'

const sample =
  '# Releasing\n\nHow a **release** goes out, see [the API](api.md#sign-in).\n\n## Steps\n\n1. one\n'

test('finds and strips the title', () => {
  assert.equal(findTitle(sample), 'Releasing')
  assert.ok(!stripTitle(sample).startsWith('#'))
  assert.ok(stripTitle(sample).includes('## Steps'))
})

test('describes the page with its first paragraph in plain text', () => {
  assert.equal(findDescription(sample), 'How a release goes out, see the API.')
  assert.equal(findDescription('# T\n\n```bash\nx\n```\n\nAfter the code.'), 'After the code.')
  assert.ok(findDescription('# T\n\n' + 'word '.repeat(60)).length <= 160)
})

test('rewrites links between docs, with and without a section', () => {
  assert.equal(
    rewriteLinks(
      '[a](api.md) [b](../guides/setup-cloud.md#x) [c](./api/sign-in.md) [d](https://x.dev/a.md)'
    ),
    '[a](../api/) [b](../../guides/setup-cloud/#x) [c](../api/sign-in/) [d](https://x.dev/a.md)'
  )
})

test('builds a page with front matter and no duplicate title', () => {
  const page = toPage('releasing/overview', sample.replaceAll('\n', '\r\n'))
  assert.match(page, /^---\ntitle: "Releasing"\n/)
  assert.match(page, /editUrl: ".*\/docs\/releasing\/overview\.md"/)
  assert.ok(!page.includes('\n# Releasing'))
  assert.ok(page.includes('](../api/#sign-in)'))
})
