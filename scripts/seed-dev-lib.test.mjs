import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSeedSql, fakeUsers, parseArgs, quote } from './seed-dev-lib.mjs'

test('fakeUsers is the same every time and uses a reserved test domain', () => {
  assert.deepEqual(fakeUsers(3), fakeUsers(3))
  assert.equal(fakeUsers(3).length, 3)
  assert.ok(fakeUsers(2).every((u) => u.email.endsWith('@example.test')))
})

test('fakeUsers rejects silly counts', () => {
  for (const bad of [0, 51, 1.5, NaN]) assert.throws(() => fakeUsers(bad))
})

test('quote doubles single quotes', () => {
  assert.equal(quote("O'Neil"), "'O''Neil'")
})

test('the SQL replaces rows instead of failing on a second run', () => {
  const sql = buildSeedSql(fakeUsers(2))
  assert.equal(sql.match(/INSERT OR REPLACE INTO user /g)?.length, 2)
  assert.equal(sql.match(/INSERT OR REPLACE INTO preference /g)?.length, 2)
  assert.ok(!/DELETE|DROP/i.test(sql))
})

test('parseArgs reads --users and refuses anything else', () => {
  assert.deepEqual(parseArgs([]), { users: 5 })
  assert.deepEqual(parseArgs(['--users', '8']), { users: 8 })
  assert.deepEqual(parseArgs(['--users=3']), { users: 3 })
  assert.throws(() => parseArgs(['--remote']), /local database/)
})
