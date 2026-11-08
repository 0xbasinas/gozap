import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkConfig,
  checkEmailDns,
  checkGitHub,
  checkHealth,
  checkSecrets,
  configString,
  exitCode,
  flattenTxt,
  formatChecks,
  ghNames,
  secretNames,
  senderDomain
} from './doctor-lib.mjs'

const byName = (checks, name) => checks.find((c) => c.name === name)

test('configString reads the first value of a key', () => {
  assert.equal(configString('{ "a": "1", "b": { "a": "2" } }', 'a'), '1')
  assert.equal(configString('{}', 'a'), null)
})

test('checkConfig flags the template placeholders', () => {
  const placeholder = `{ "database_id": "00000000-0000-0000-0000-000000000000",
    "BETTER_AUTH_URL": "http://localhost:8787", "EMAIL_FROM": "App <login@example.com>",
    "previews": { "database_id": "00000000-0000-0000-0000-000000000001" } }`
  const checks = checkConfig(placeholder)
  assert.equal(byName(checks, 'Database id').status, 'fail')
  assert.equal(byName(checks, 'Site address').status, 'fail')
  assert.equal(byName(checks, 'Sender address').status, 'warn')
  assert.equal(byName(checks, 'Preview database').status, 'warn')
  assert.equal(exitCode(checks), 1)
})

test('checkConfig accepts a finished setup', () => {
  const done = `{ "database_id": "11111111-2222-3333-4444-555555555555",
    "BETTER_AUTH_URL": "https://app.example.org", "EMAIL_FROM": "App <login@mail.example.org>",
    "previews": { "database_id": "66666666-2222-3333-4444-555555555555" } }`
  assert.ok(checkConfig(done).every((c) => c.status === 'ok'))
})

test('senderDomain finds the domain in both address forms', () => {
  assert.equal(senderDomain('My App <Login@Mail.Example.org>'), 'mail.example.org')
  assert.equal(senderDomain('login@example.org'), 'example.org')
  assert.equal(senderDomain('nonsense'), null)
})

test('checkSecrets: missing required secrets fail, optional ones only warn or skip', () => {
  const checks = checkSecrets(['BETTER_AUTH_SECRET'])
  assert.equal(byName(checks, 'Secret BETTER_AUTH_SECRET').status, 'ok')
  assert.equal(byName(checks, 'Secret RESEND_API_KEY').status, 'fail')
  assert.equal(byName(checks, 'Secret RESEND_WEBHOOK_SECRET').status, 'warn')
  assert.equal(byName(checks, 'Secret SENTRY_DSN').status, 'skip')
  assert.equal(exitCode(checks), 1)
})

test('secretNames and ghNames survive bad output', () => {
  assert.deepEqual(secretNames('[{"name":"A","type":"secret_text"}]'), ['A'])
  assert.deepEqual(secretNames('not json'), [])
  assert.deepEqual(ghNames('[{"name":"X"},{"name":"Y"}]'), ['X', 'Y'])
  assert.deepEqual(ghNames(''), [])
})

test('checkGitHub only asks for deploy secrets once deploys are on', () => {
  const off = checkGitHub({ variables: ['API_URL'], secrets: [], variableValues: {} })
  assert.equal(byName(off, 'Variable CLOUDFLARE_DEPLOY').status, 'warn')
  assert.equal(off.length, 2)
  const on = checkGitHub({
    variables: ['API_URL', 'CLOUDFLARE_DEPLOY'],
    secrets: ['CLOUDFLARE_API_TOKEN'],
    variableValues: { CLOUDFLARE_DEPLOY: 'true' }
  })
  assert.equal(byName(on, 'Secret CLOUDFLARE_ACCOUNT_ID').status, 'fail')
  assert.equal(byName(on, 'Secret BACKUP_PASSPHRASE').status, 'warn')
})

test('checkEmailDns', () => {
  const good = checkEmailDns({
    domain: 'mail.example.org',
    root: ['v=spf1 include:amazonses.com ~all'],
    dmarc: ['v=DMARC1; p=none;'],
    dkim: ['p=MIGfMA0GCS']
  })
  assert.ok(good.every((c) => c.status === 'ok'))
  const bad = checkEmailDns({ domain: 'example.org', root: [], dmarc: [], dkim: [] })
  assert.equal(byName(bad, 'DMARC for example.org').status, 'warn')
  assert.equal(byName(bad, 'DKIM for example.org').status, 'fail')
})

test('flattenTxt joins the chunks of long records', () => {
  assert.deepEqual(flattenTxt([['v=DMARC1; ', 'p=none']]), ['v=DMARC1; p=none'])
})

test('checkHealth', () => {
  const url = 'https://app.example.org'
  assert.equal(checkHealth(url, { status: 200, body: '{"ok":true}' }).status, 'ok')
  assert.equal(checkHealth(url, { status: 500, body: '' }).status, 'fail')
  assert.equal(checkHealth(url, { error: 'fetch failed' }).status, 'fail')
})

test('formatChecks shows the fix only for problems', () => {
  const out = formatChecks([
    { status: 'ok', name: 'A', fix: 'never shown' },
    { status: 'fail', name: 'B', detail: 'broken', fix: 'do this' }
  ])
  assert.ok(!out.includes('never shown'))
  assert.match(out, /✘ B — broken\n\s+→ do this/)
})
