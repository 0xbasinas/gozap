import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roleSql } from './admin-lib.mjs'

test('grants admin by default and support when asked', () => {
  assert.equal(
    roleSql('grant', ' Ada@Example.com '),
    "UPDATE user SET role = 'admin' WHERE email = 'ada@example.com';"
  )
  assert.match(roleSql('grant', 'a@b.co', 'support'), /role = 'support'/)
})

test('revokes back to an ordinary user', () => {
  assert.match(roleSql('revoke', 'a@b.co'), /role = 'user'/)
})

test('refuses anything that is not a plain address or a staff role', () => {
  assert.throws(() => roleSql('grant', "x'; DROP TABLE user;--@b.co"))
  assert.throws(() => roleSql('grant', 'nope'))
  assert.throws(() => roleSql('grant', 'a@b.co', 'owner'))
  assert.throws(() => roleSql('grant', 'a@b.co', 'user'))
  assert.throws(() => roleSql('delete', 'a@b.co'))
})
