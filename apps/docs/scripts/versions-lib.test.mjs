import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildSidebar,
  checkSlug,
  pickerTarget,
  rootPage,
  stripVersion,
  versionOf
} from './versions-lib.mjs'

const v1 = { slug: '1-0', label: '1.0' }
const sections = [
  { label: 'Guides', pages: ['guides/a', 'guides/b'] },
  { label: 'API', pages: ['api/overview', 'api/new'], labels: { 'api/overview': 'Overview' } }
]
const pages = new Set([
  'guides/a',
  'guides/b',
  'api/overview',
  'api/new',
  '1-0/guides/a',
  '1-0/api/overview'
])
const has = (id) => pages.has(id)

test('finds the version of a page', () => {
  assert.equal(versionOf('1-0/guides/a', [v1]), v1)
  assert.equal(versionOf('guides/a', [v1]), null)
  assert.equal(versionOf('1-0x/guides/a', [v1]), null)
  assert.equal(stripVersion('1-0/guides/a', v1), 'guides/a')
  assert.equal(stripVersion('guides/a', null), 'guides/a')
})

test('builds the sidebar for the latest docs and each version, skipping pages a version lacks', () => {
  const sidebar = buildSidebar(sections, [v1], has)
  assert.deepEqual(
    sidebar.map((g) => g.items.map((i) => i.slug)),
    [['guides/a', 'guides/b'], ['api/overview', 'api/new'], ['1-0/guides/a'], ['1-0/api/overview']]
  )
  assert.equal(sidebar[1].items[0].label, 'Overview')
})

test('the picker keeps the page when it exists and falls back to the first page', () => {
  const base = { sections, hasPage: has, redirect: 'same-page' }
  assert.equal(pickerTarget({ ...base, id: 'guides/a', from: null, to: v1 }), '/1-0/guides/a/')
  assert.equal(pickerTarget({ ...base, id: 'api/new', from: null, to: v1 }), '/1-0/guides/a/')
  assert.equal(pickerTarget({ ...base, id: '1-0/guides/a', from: v1, to: null }), '/guides/a/')
  assert.equal(
    pickerTarget({ ...base, redirect: 'root', id: 'guides/b', from: null, to: v1 }),
    '/1-0/guides/a/'
  )
  assert.equal(
    pickerTarget({ ...base, redirect: 'root', id: '1-0/guides/a', from: v1, to: null }),
    '/'
  )
  assert.equal(rootPage(sections, has, v1), '1-0/guides/a')
})

test('rejects slugs that clash or are not URL friendly', () => {
  assert.equal(checkSlug('1-0', sections), null)
  assert.match(checkSlug('API', sections), /lowercase/)
  assert.match(checkSlug('guides', sections), /already a docs folder/)
})
