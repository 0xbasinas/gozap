import test from 'node:test'
import assert from 'node:assert/strict'
import { flagSql } from './flags-lib.mjs'

test('kill and revive flip the switch', () => {
  assert.match(flagSql('kill', 'new-editor', {}, 1), /killed = 1.*'new-editor'/)
  assert.match(flagSql('revive', 'new-editor', {}, 1), /killed = 0/)
})
test('set defaults to everyone and escapes text', () => {
  const sql = flagSql('set', 'a-b', { description: "it's" }, 1)
  assert.match(sql, /'it''s'/)
  assert.match(sql, /'', 100, 1\)/)
})
test('rejects bad input', () => {
  assert.throws(() => flagSql('set', 'Bad Key'))
  assert.throws(() => flagSql('set', 'ok', { percent: '101' }))
  assert.throws(() => flagSql('set', 'ok', { channels: 'nightly' }))
  assert.throws(() => flagSql('nope', 'ok'))
})
