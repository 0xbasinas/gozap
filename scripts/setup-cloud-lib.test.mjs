import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  assertDomain,
  dmarcRecord,
  fromAddress,
  generateSecret,
  isSentryDsn,
  mask,
  normalizeSiteUrl,
  parseArgs,
  findDatabaseId,
  parseDatabaseId,
  patchPreviewDatabase,
  patchWorkerName,
  PREVIEW_DB_PLACEHOLDER,
  patchWranglerConfig,
  recordExists,
  toCloudflareRecords,
  webhookEndpoint
} from './setup-cloud-lib.mjs'

const CONFIG = `{
  // keep me
  "routes": [],
  "d1_databases": [{ "binding": "DB", "database_id": "00000000-0000-0000-0000-000000000000" }],
  "vars": {
    "BETTER_AUTH_URL": "http://localhost:8787",
    "EMAIL_FROM": "Electron Desktop Template <login@example.com>"
  }
}`

test('patchWranglerConfig changes only the placeholders and keeps comments', () => {
  const out = patchWranglerConfig(CONFIG, {
    databaseId: '11111111-2222-3333-4444-555555555555',
    siteUrl: 'https://app.example.org',
    from: 'My "App" <login@example.org>',
    routeHost: 'app.example.org'
  })
  assert.match(out, /\/\/ keep me/)
  assert.match(out, /"database_id": "11111111-2222-3333-4444-555555555555"/)
  assert.match(out, /"BETTER_AUTH_URL": "https:\/\/app\.example\.org"/)
  assert.match(
    out,
    /"EMAIL_FROM": "My App <login@example\.org>"|"EMAIL_FROM": "My \\"App\\" <login@example\.org>"/
  )
  assert.match(out, /"routes": \[\{ "pattern": "app\.example\.org", "custom_domain": true \}\]/)
})

test('patchWranglerConfig can clear the route again and fails loudly when a line is missing', () => {
  const withRoute = patchWranglerConfig(CONFIG, { routeHost: 'a.example.org' })
  assert.match(patchWranglerConfig(withRoute, { routeHost: '' }), /"routes": \[\]/)
  assert.throws(() => patchWranglerConfig('{}', { databaseId: 'x' }), /database_id/)
})

test('normalizeSiteUrl accepts https origins and rejects the rest', () => {
  assert.equal(normalizeSiteUrl('https://app.example.com/some/path'), 'https://app.example.com')
  assert.equal(normalizeSiteUrl('http://localhost:8787'), 'http://localhost:8787')
  assert.throws(() => normalizeSiteUrl('http://app.example.com'), /https/)
  assert.throws(() => normalizeSiteUrl('app.example.com'), /not a web address/)
})

test('assertDomain', () => {
  assert.equal(assertDomain('mail.example.co.uk'), 'mail.example.co.uk')
  for (const bad of ['example', 'https://example.com', 'a b.com', '-x.com']) {
    assert.throws(() => assertDomain(bad))
  }
})

test('fromAddress strips characters that could break the header', () => {
  assert.equal(fromAddress('Acme <Inc>\r\n', 'example.com'), 'Acme Inc <login@example.com>')
  assert.equal(fromAddress('', 'example.com'), 'App <login@example.com>')
})

test('parseDatabaseId reads wrangler output', () => {
  const id = '0a1b2c3d-4e5f-6789-abcd-ef0123456789'
  assert.equal(parseDatabaseId(`{ "uuid": "${id}", "name": "x" }`), id)
  assert.equal(parseDatabaseId(`"database_id": "${id}"`), id)
  assert.equal(parseDatabaseId('nothing here'), null)
})

test('toCloudflareRecords builds full names, MX priority and DNS-only CNAMEs', () => {
  const out = toCloudflareRecords(
    [
      { record: 'DKIM', name: 'resend._domainkey', type: 'TXT', value: 'p=abc', ttl: 'Auto' },
      {
        record: 'SPF',
        name: 'send',
        type: 'MX',
        value: 'feedback-smtp.us-east-1.amazonses.com',
        priority: 10,
        ttl: 'Auto'
      },
      {
        record: 'Tracking',
        name: 'links',
        type: 'CNAME',
        value: 'links1.resend-dns.com',
        ttl: 'Auto'
      },
      { name: '@', type: 'TXT', value: 'v=DMARC1', ttl: 3600 }
    ],
    'example.com'
  )
  assert.deepEqual(out[0], {
    type: 'TXT',
    name: 'resend._domainkey.example.com',
    content: 'p=abc',
    ttl: 1
  })
  assert.equal(out[1].priority, 10)
  assert.equal(out[2].proxied, false)
  assert.equal(out[3].name, 'example.com')
  assert.equal(out[3].ttl, 3600)
})

test('recordExists ignores case, quotes and a trailing dot', () => {
  const existing = [
    { type: 'TXT', name: 'Send.example.com', content: '"v=spf1 include:amazonses.com ~all"' }
  ]
  assert.ok(
    recordExists(existing, {
      type: 'TXT',
      name: 'send.example.com',
      content: 'v=spf1 include:amazonses.com ~all'
    })
  )
  assert.ok(
    !recordExists(existing, {
      type: 'MX',
      name: 'send.example.com',
      content: 'v=spf1 include:amazonses.com ~all'
    })
  )
})

test('parseArgs', () => {
  const a = parseArgs(['--url', 'https://x.example.com', '--skip-github'])
  assert.equal(a.values.url, 'https://x.example.com')
  assert.ok(a.flags.has('skip-github'))
  assert.ok(parseArgs(['--yes']).flags.has('yes'))
  assert.throws(() => parseArgs(['--nope']), /Unknown option/)
  assert.throws(() => parseArgs(['--url']), /needs a value/)
  assert.throws(() => parseArgs(['stray']), /Unexpected/)
})

test('secrets are long, random and masked in output', () => {
  const a = generateSecret()
  assert.ok(a.length >= 43)
  assert.notEqual(a, generateSecret())
  assert.equal(mask('re_abcdefghijkl'), 're_a…')
  assert.equal(mask('short'), '****')
})

test('isSentryDsn', () => {
  assert.ok(isSentryDsn('https://abc123@o12345.ingest.sentry.io/678'))
  for (const bad of ['', 'http://abc@host/1', 'https://host/1', 'https://abc@host/', 'nope']) {
    assert.ok(!isSentryDsn(bad), bad)
  }
})

test('dmarcRecord and webhookEndpoint', () => {
  assert.deepEqual(dmarcRecord('example.com'), {
    type: 'TXT',
    name: '_dmarc.example.com',
    content: 'v=DMARC1; p=none;',
    ttl: 1
  })
  assert.equal(
    webhookEndpoint('https://app.example.com'),
    'https://app.example.com/api/webhooks/resend'
  )
  assert.equal(webhookEndpoint('http://localhost:8787'), null)
})

test('patchPreviewDatabase points the preview entry at the real database and leaves production alone', () => {
  const text = `{"d1_databases":[{"database_name":"app","database_id":"prod-id"}],
  "previews":{"d1_databases":[{"database_name": "app-preview","database_id":"${PREVIEW_DB_PLACEHOLDER}"}]}}`
  const out = patchPreviewDatabase(text, { name: 'my-app-preview', id: 'abc-123' })
  assert.match(out, /"database_name": "my-app-preview"/)
  assert.match(out, /"database_id":"abc-123"/)
  assert.match(out, /"database_name":"app"/)
  assert.match(out, /"prod-id"/)
  assert.throws(() => patchPreviewDatabase('{}', { name: 'x', id: 'y' }))
})

test('findDatabaseId finds a database by name in the account list', () => {
  const list = JSON.stringify([
    { uuid: 'aaaaaaaa-0000-0000-0000-000000000000', name: 'other' },
    { uuid: 'bbbbbbbb-0000-0000-0000-000000000000', name: 'mine' }
  ])
  assert.equal(
    findDatabaseId(`⛅️ wrangler\n${list}`, 'mine'),
    'bbbbbbbb-0000-0000-0000-000000000000'
  )
  assert.equal(findDatabaseId(list, 'missing'), null)
  assert.equal(findDatabaseId('no json here', 'mine'), null)
})

test('patchWranglerConfig sets APP_NAME everywhere and fails when there is none', () => {
  const text = `{ "vars": { "APP_NAME": "Old" }, "previews": { "vars": { "APP_NAME": "Old" } } }`
  const out = patchWranglerConfig(text, { appName: 'My "App"' })
  assert.equal(out.match(/"APP_NAME": "My \\"App\\""/g).length, 2)
  assert.throws(() => patchWranglerConfig('{}', { appName: 'X' }), /APP_NAME/)
})

test('patchWorkerName names the Worker and its production database, not the preview one', () => {
  const text = `{ "name": "old", "d1_databases": [{ "database_name": "old" }],
    "previews": { "d1_databases": [{ "database_name": "old-preview" }] } }`
  const out = patchWorkerName(text, 'gozap')
  assert.match(out, /"name": "gozap"/)
  assert.match(out, /"database_name": "gozap"/)
  assert.match(out, /"database_name": "old-preview"/)
  assert.throws(() => patchWorkerName('{}', 'x'))
})
