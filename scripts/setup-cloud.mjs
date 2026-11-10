#!/usr/bin/env node
// One-command setup for the website and API on Cloudflare (+ Resend for email, + GitHub for automatic deploys).
// Usage: pnpm setup:cloud [--url https://app.example.com] [--email-domain example.com] [--from-name "My App"]
//                         [--skip-resend] [--skip-github] [--skip-deploy] [--rotate-secret] [--yes]
// It is safe to run again: every step looks at what already exists first. See docs/guides/setup-cloud.md.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveTxt } from 'node:dns/promises'
import { createInterface } from 'node:readline/promises'
import {
  assertDomain,
  dmarcRecord,
  fromAddress,
  generateSecret,
  isSentryDsn,
  isWorkersDev,
  mask,
  normalizeSiteUrl,
  parseArgs,
  findDatabaseId,
  patchPreviewDatabase,
  patchWorkerName,
  patchWranglerConfig,
  recordExists,
  secretsFileContent,
  toCloudflareRecords,
  WEBHOOK_EVENTS,
  webhookEndpoint
} from './setup-cloud-lib.mjs'

const CONFIG_PATH = 'apps/api/wrangler.jsonc'
const WORKER_NAME = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8')).name
const isWindows = process.platform === 'win32'

let args
try {
  args = parseArgs(process.argv.slice(2))
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
if (args.flags.has('help')) {
  console.log(
    readFileSync(new URL(import.meta.url), 'utf8')
      .split('\n')
      .slice(1, 5)
      .join('\n')
      .replaceAll('// ', '')
  )
  process.exit(0)
}

const say = (msg = '') => console.log(msg)
const step = (n, title) => say(`\n[${n}] ${title}`)
const ok = (msg) => say(`    ✔ ${msg}`)
const note = (msg) => say(`    · ${msg}`)
const fail = (msg) => {
  console.error(`\n✖ ${msg}`)
  process.exit(1)
}

const rl = createInterface({ input: process.stdin, output: process.stdout })

async function ask(question, fallback) {
  const answer = (await rl.question(`    ${question}${fallback ? ` [${fallback}]` : ''}: `)).trim()
  return answer || fallback || ''
}

/**
 * Yes/no question for optional sub-flows, so anything you already did yourself can be skipped.
 * Without a terminal, or with --yes, the default is taken.
 */
async function confirm(question, defaultYes = true) {
  if (args.flags.has('yes') || !process.stdin.isTTY) return defaultYes
  const answer = (await rl.question(`    ${question} [${defaultYes ? 'Y/n' : 'y/N'}]: `))
    .trim()
    .toLowerCase()
  return answer === '' ? defaultYes : answer.startsWith('y')
}

/** Ask for a secret without echoing it back to the terminal. */
async function askSecret(question) {
  const original = rl._writeToOutput
  process.stdout.write(`    ${question}: `)
  rl._writeToOutput = () => {}
  try {
    return (await rl.question('')).trim()
  } finally {
    rl._writeToOutput = original
    process.stdout.write('\n')
  }
}

/** Run a command; stdout is returned. `pnpm` needs a shell on Windows. */
function run(cmd, cmdArgs, { input, inherit = false, allowFail = false, env } = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    encoding: 'utf8',
    input,
    shell: isWindows,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env }
  })
  if (result.status !== 0 && !allowFail) {
    const detail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
    fail(`\`${cmd} ${cmdArgs.join(' ')}\` failed.${detail ? `\n${detail}` : ''}`)
  }
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

const wrangler = (wranglerArgs, options) =>
  run('pnpm', ['--filter', '@repo/api', 'exec', 'wrangler', ...wranglerArgs], options)

async function api(base, token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = { raw: text }
  }
  return { status: response.status, ok: response.ok, json }
}

// ---------------------------------------------------------------------------------------------------------------------
say(
  'Setting up the website and API. Nothing is sent anywhere except Cloudflare, Resend and GitHub.'
)

// 1 -------------------------------------------------------------------------------------------------------------------
step(1, 'Cloudflare account')
let whoami = wrangler(['whoami'], { allowFail: true })
if (!whoami.ok || /not authenticated/i.test(whoami.out)) {
  note('Not signed in to Cloudflare. A browser window will open.')
  wrangler(['login'], { inherit: true })
  whoami = wrangler(['whoami'])
}
const accountIds = [...new Set(whoami.out.match(/\b[0-9a-f]{32}\b/g) ?? [])]
let accountId = process.env.CLOUDFLARE_ACCOUNT_ID
if (!accountId) {
  if (accountIds.length === 1) accountId = accountIds[0]
  else if (accountIds.length > 1) {
    accountId = await ask(`Which account id? (${accountIds.join(', ')})`)
    if (!accountIds.includes(accountId)) fail('That is not one of your account ids.')
  }
}
ok(accountId ? `Signed in (account ${mask(accountId)})` : 'Signed in')

// 2 -------------------------------------------------------------------------------------------------------------------
step(2, 'Where the site will live')
let config = readFileSync(CONFIG_PATH, 'utf8')
const currentUrl = /"BETTER_AUTH_URL":\s*"([^"]*)"/.exec(config)?.[1]
const suggested = currentUrl && !currentUrl.startsWith('http://localhost') ? currentUrl : undefined
let siteUrl
try {
  siteUrl = normalizeSiteUrl(
    args.values.url ?? (await ask('Public address of the site (https://…)', suggested))
  )
} catch (error) {
  fail(error.message)
}
const siteHost = new URL(siteUrl).hostname
const useCustomDomain = !isWorkersDev(siteHost) && siteHost !== 'localhost'
ok(
  useCustomDomain
    ? `Custom domain ${siteHost} (its zone must be in this Cloudflare account)`
    : siteUrl
)

// 3 -------------------------------------------------------------------------------------------------------------------
step(3, 'Database (D1)')
const dbName = WORKER_NAME
const d1Id = (name) => {
  const list = wrangler(['d1', 'list', '--json'], { allowFail: true })
  return list.ok ? findDatabaseId(list.out, name) : null
}
let databaseId = d1Id(dbName)
if (databaseId) {
  ok(`Database "${dbName}" already exists`)
} else {
  wrangler(['d1', 'create', dbName])
  databaseId = d1Id(dbName)
  if (!databaseId)
    fail(
      'Created the database but could not read its id. Run `wrangler d1 list` and paste it into wrangler.jsonc.'
    )
  ok(`Created database "${dbName}"`)
}

// The shared staging database for pull request previews (never production data).
const previewDbName = `${WORKER_NAME}-preview`
let previewDatabaseId = d1Id(previewDbName)
if (previewDatabaseId) {
  ok(`Preview database "${previewDbName}" already exists`)
} else if (
  !(await confirm('Create a staging database for pull request previews? (not production data)'))
) {
  note(
    'Skipped. Previews stay off until you create it (docs/api/operations.md, Previews) or run this again.'
  )
} else {
  wrangler(['d1', 'create', previewDbName])
  previewDatabaseId = d1Id(previewDbName)
  if (!previewDatabaseId)
    fail(
      'Created the preview database but could not read its id. Run `wrangler d1 list` and paste it into wrangler.jsonc and wrangler.preview-migrations.jsonc.'
    )
  ok(`Created preview database "${previewDbName}"`)
}

// 4 -------------------------------------------------------------------------------------------------------------------
let from
let appName
let workerResendKey
if (args.flags.has('skip-resend')) {
  step(4, 'Email (Resend): skipped')
  note(
    'Without RESEND_API_KEY the sign-in link is printed in the Worker logs instead of being emailed.'
  )
} else {
  step(4, 'Email (Resend)')
  const sendingDomain = assertDomain(
    args.values['email-domain'] ??
      (await ask('Domain to send sign-in emails from', siteHost.split('.').slice(-2).join('.')))
  )
  const displayName =
    args.values['from-name'] ?? (await ask('Sender name', 'Electron Desktop Template'))
  appName = displayName
  from = fromAddress(displayName, sendingDomain)

  const resendKey =
    process.env.RESEND_SETUP_KEY ??
    (await askSecret(
      'Resend API key with full access (https://resend.com/api-keys; not saved anywhere)'
    ))
  if (!resendKey) fail('A Resend API key is needed. Use --skip-resend to leave email for later.')
  const resend = (path, options) => api('https://api.resend.com', resendKey, path, options)

  const list = await resend('/domains')
  if (!list.ok) fail(`Resend rejected the key (${list.status}): ${JSON.stringify(list.json)}`)
  let domain = (list.json.data ?? []).find((d) => d.name === sendingDomain)
  if (!domain) {
    const created = await resend('/domains', { method: 'POST', body: { name: sendingDomain } })
    if (!created.ok)
      fail(`Could not add ${sendingDomain} to Resend: ${JSON.stringify(created.json)}`)
    domain = created.json
    ok(`Added ${sendingDomain} to Resend`)
  } else {
    ok(`${sendingDomain} is already in Resend (${domain.status})`)
  }

  if (domain.status !== 'verified') {
    const detail = await resend(`/domains/${domain.id}`)
    const records = detail.json.records ?? []
    const wanted = toCloudflareRecords(records, sendingDomain)
    const cfToken = process.env.CLOUDFLARE_API_TOKEN
    let added = false
    if (await confirm("Have you already added Resend's DNS records yourself?", false)) {
      note('Skipping the DNS records; going straight to verification.')
      added = true
    } else if (cfToken) {
      const zones = await api(
        'https://api.cloudflare.com/client/v4',
        cfToken,
        `/zones?name=${sendingDomain}`
      )
      const zone = zones.json.result?.[0]
      if (zone) {
        const existing = await api(
          'https://api.cloudflare.com/client/v4',
          cfToken,
          `/zones/${zone.id}/dns_records?per_page=500`
        )
        for (const record of wanted) {
          if (recordExists(existing.json.result ?? [], record)) continue
          const res = await api(
            'https://api.cloudflare.com/client/v4',
            cfToken,
            `/zones/${zone.id}/dns_records`,
            {
              method: 'POST',
              body: record
            }
          )
          if (!res.ok)
            fail(
              `Cloudflare refused the ${record.type} record ${record.name}: ${JSON.stringify(res.json.errors)}`
            )
        }
        ok(`DNS records are in Cloudflare (${sendingDomain})`)
        added = true
      } else {
        note(`${sendingDomain} is not a zone in the account of CLOUDFLARE_API_TOKEN.`)
      }
    }
    if (!added) {
      say(
        '\n    Add these DNS records where your domain is managed, then run this command again:\n'
      )
      for (const r of wanted) {
        say(
          `      ${r.type.padEnd(5)} ${r.name}${r.priority ? `  (priority ${r.priority})` : ''}\n            ${r.content}`
        )
      }
      note('Tip: with CLOUDFLARE_API_TOKEN (Zone → DNS → Edit) set, this step adds them for you.')
    }
    await resend(`/domains/${domain.id}/verify`, { method: 'POST' })
    note('Waiting for Resend to verify the domain (DNS can take a few minutes)…')
    let status = domain.status
    for (let i = 0; i < 30 && status !== 'verified'; i++) {
      await new Promise((r) => setTimeout(r, 10_000))
      status = (await resend(`/domains/${domain.id}`)).json.status
      if (status === 'failed') break
    }
    if (status !== 'verified') {
      fail(
        `${sendingDomain} is "${status}" in Resend. Fix the DNS records above and run \`pnpm setup:cloud\` again.`
      )
    }
    ok('Domain verified')
  }

  // The Worker only ever needs to send mail, from this one domain: give it a key that can do nothing else.
  // DMARC: a starter policy that only asks for reports. Mailbox providers expect one from every sender.
  const dmarc = dmarcRecord(sendingDomain)
  const hasDmarc = await resolveTxt(dmarc.name).then(
    (rows) => rows.some((r) => r.join('').startsWith('v=DMARC1')),
    () => false
  )
  if (hasDmarc) {
    ok('DMARC record already exists')
  } else if (!(await confirm('Add a starter DMARC record (reports only)?'))) {
    note('Skipped the DMARC record.')
  } else if (process.env.CLOUDFLARE_API_TOKEN) {
    const cf = 'https://api.cloudflare.com/client/v4'
    const zones = await api(cf, process.env.CLOUDFLARE_API_TOKEN, `/zones?name=${sendingDomain}`)
    const zone = zones.json.result?.[0]
    if (zone) {
      const res = await api(cf, process.env.CLOUDFLARE_API_TOKEN, `/zones/${zone.id}/dns_records`, {
        method: 'POST',
        body: dmarc
      })
      if (res.ok) ok('Added a DMARC record (p=none: reports only, nothing is rejected)')
      else note(`Could not add the DMARC record: ${JSON.stringify(res.json.errors)}`)
    } else {
      note(`Add this DNS record yourself: TXT ${dmarc.name} = "${dmarc.content}"`)
    }
  } else {
    note(`Recommended DNS record: TXT ${dmarc.name} = "${dmarc.content}"`)
  }

  workerResendKey = {
    domainId: domain.id,
    resend,
    endpoint: (await confirm('Set up bounce and complaint handling (Resend webhook)?'))
      ? webhookEndpoint(siteUrl)
      : null
  }
}

// 5 -------------------------------------------------------------------------------------------------------------------
step(5, 'Write the settings into apps/api/wrangler.jsonc')
config = patchWranglerConfig(config, {
  databaseId,
  siteUrl,
  from,
  appName,
  routeHost: useCustomDomain ? siteHost : ''
})
// The Worker (and its database) are named after the app, so they are easy to find in the Cloudflare dashboard.
config = patchWorkerName(config, WORKER_NAME)
writeFileSync(CONFIG_PATH, config)
const PREVIEW_MIGRATIONS_PATH = 'apps/api/wrangler.preview-migrations.jsonc'
writeFileSync(
  PREVIEW_MIGRATIONS_PATH,
  patchWorkerName(readFileSync(PREVIEW_MIGRATIONS_PATH, 'utf8'), WORKER_NAME)
)
for (const path of previewDatabaseId ? [CONFIG_PATH, PREVIEW_MIGRATIONS_PATH] : []) {
  const text = readFileSync(path, 'utf8')
  writeFileSync(path, patchPreviewDatabase(text, { name: previewDbName, id: previewDatabaseId }))
}
ok(
  'name, database_id, BETTER_AUTH_URL' +
    (from ? ', EMAIL_FROM' : '') +
    (useCustomDomain ? ', routes' : '')
)

// 6 -------------------------------------------------------------------------------------------------------------------
step(6, 'Secrets')
const listed = wrangler(['secret', 'list', '--format', 'json'], { allowFail: true })
const have = new Set()
if (listed.ok) {
  try {
    for (const s of JSON.parse(listed.out.slice(listed.out.indexOf('[')))) have.add(s.name)
  } catch {
    // an empty or unreadable list just means we set everything
  }
}
const secrets = {}
if (!have.has('BETTER_AUTH_SECRET') || args.flags.has('rotate-secret')) {
  secrets.BETTER_AUTH_SECRET = generateSecret()
  ok(
    args.flags.has('rotate-secret')
      ? 'New BETTER_AUTH_SECRET (everyone is signed out)'
      : 'Generated BETTER_AUTH_SECRET'
  )
} else {
  note('BETTER_AUTH_SECRET is already set; keeping it so nobody is signed out.')
}
if (workerResendKey && !have.has('RESEND_API_KEY')) {
  const created = await workerResendKey.resend('/api-keys', {
    method: 'POST',
    body: {
      name: `${WORKER_NAME} worker`,
      permission: 'sending_access',
      domain_id: workerResendKey.domainId
    }
  })
  if (!created.ok || !created.json.token)
    fail(`Resend would not create a sending key: ${JSON.stringify(created.json)}`)
  secrets.RESEND_API_KEY = created.json.token
  ok('Created a Resend key that can only send from your domain')
} else if (workerResendKey) {
  note('RESEND_API_KEY is already set.')
}

// Bounces and spam complaints: Resend calls the Worker, which stops emailing those addresses (docs/api/operations.md).
if (workerResendKey && !have.has('RESEND_WEBHOOK_SECRET')) {
  if (!workerResendKey.endpoint) {
    note(
      'Bounce handling is off (it needs the public https address and your OK). Run again to add it.'
    )
  } else {
    const { resend } = workerResendKey
    const list = await resend('/webhooks')
    let hook = (list.json.data ?? []).find((w) => w.endpoint === workerResendKey.endpoint)
    let signingSecret
    if (hook) {
      signingSecret = (await resend(`/webhooks/${hook.id}`)).json.signing_secret
    } else {
      const created = await resend('/webhooks', {
        method: 'POST',
        body: { endpoint: workerResendKey.endpoint, events: WEBHOOK_EVENTS }
      })
      if (!created.ok)
        note(
          `Resend would not create the webhook yet (${JSON.stringify(created.json)}). Run this again after the first deploy.`
        )
      signingSecret = created.ok ? created.json.signing_secret : undefined
    }
    if (signingSecret) {
      secrets.RESEND_WEBHOOK_SECRET = signingSecret
      ok('Bounce and complaint handling is on (Resend webhook)')
    } else {
      note(
        'Could not read the webhook signing secret; copy it from the Resend dashboard (Webhooks) into RESEND_WEBHOOK_SECRET.'
      )
    }
  }
} else if (workerResendKey) {
  note('RESEND_WEBHOOK_SECRET is already set.')
}

if (process.env.SENTRY_DSN && (!have.has('SENTRY_DSN') || args.flags.has('rotate-secret'))) {
  if (!isSentryDsn(process.env.SENTRY_DSN))
    fail('SENTRY_DSN does not look like a Sentry DSN (https://<key>@<host>/<project id>).')
  secrets.SENTRY_DSN = process.env.SENTRY_DSN
  ok('Error reporting to Sentry is on')
} else if (have.has('SENTRY_DSN')) {
  note('SENTRY_DSN is already set.')
} else {
  note(
    'No SENTRY_DSN: errors are only in the Cloudflare logs. Set it and run again to turn on Sentry (docs/guides/setup-cloud.md).'
  )
}

// 7 -------------------------------------------------------------------------------------------------------------------
if (args.flags.has('skip-deploy')) {
  step(7, 'Deploy: skipped')
} else {
  step(7, 'Build, migrate and deploy')
  run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@repo/web'], { inherit: true })
  wrangler(['d1', 'migrations', 'apply', 'DB', '--remote'], { inherit: true })
  const dir = mkdtempSync(join(tmpdir(), 'setup-cloud-'))
  const secretsFile = join(dir, 'secrets.json')
  try {
    const deployArgs = ['deploy']
    if (Object.keys(secrets).length > 0) {
      writeFileSync(secretsFile, secretsFileContent(secrets), { mode: 0o600 })
      deployArgs.push('--secrets-file', secretsFile)
    }
    wrangler(deployArgs, { inherit: true })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  ok(`Deployed: ${siteUrl}`)
}

// 8 -------------------------------------------------------------------------------------------------------------------
if (args.flags.has('skip-github')) {
  step(8, 'GitHub: skipped')
} else {
  step(8, 'GitHub (automatic deploys and release builds)')
  const gh = run('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], {
    allowFail: true
  })
  if (!gh.ok) {
    note('The GitHub CLI is not set up here (`gh auth login`), so these are left for you:')
    note(`gh variable set API_URL --body ${siteUrl}`)
    note('gh variable set CLOUDFLARE_DEPLOY --body true')
    note('gh secret set CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN')
  } else {
    const repo = gh.out.trim()
    run('gh', ['variable', 'set', 'API_URL', '--body', siteUrl, '--repo', repo])
    ok(`API_URL = ${siteUrl}`)
    if (process.env.CLOUDFLARE_API_TOKEN && accountId) {
      run('gh', ['secret', 'set', 'CLOUDFLARE_API_TOKEN', '--repo', repo], {
        input: process.env.CLOUDFLARE_API_TOKEN
      })
      run('gh', ['secret', 'set', 'CLOUDFLARE_ACCOUNT_ID', '--repo', repo], { input: accountId })
      run('gh', ['variable', 'set', 'CLOUDFLARE_DEPLOY', '--body', 'true', '--repo', repo])
      ok('Cloudflare secrets saved; automatic deploys are on')
      // Previews do not inherit production secrets. Give them their own signing secret (never the production one).
      const previewSecrets = wrangler(
        ['preview', 'base-config', 'secret', 'list', '--format', 'json'],
        {
          allowFail: true
        }
      )
      if (previewSecrets.ok && /BETTER_AUTH_SECRET/.test(previewSecrets.out)) {
        note('Previews already have their own BETTER_AUTH_SECRET.')
      } else {
        const put = wrangler(['preview', 'base-config', 'secret', 'put', 'BETTER_AUTH_SECRET'], {
          allowFail: true,
          input: generateSecret()
        })
        if (put.ok) ok('Previews have their own BETTER_AUTH_SECRET (not the production one)')
        else
          note(
            'Could not give previews a secret. Run: pnpm --filter @repo/api exec wrangler preview base-config secret put BETTER_AUTH_SECRET'
          )
      }
      const existingSecrets = run('gh', ['secret', 'list', '--repo', repo], { allowFail: true }).out
      if (!/^BACKUP_PASSPHRASE\b/m.test(existingSecrets)) {
        // GitHub secrets cannot be read back, so this is the only time the passphrase is ever shown.
        const passphrase = generateSecret()
        run('gh', ['secret', 'set', 'BACKUP_PASSPHRASE', '--repo', repo], { input: passphrase })
        ok('Daily encrypted database backups are on')
        say('')
        say('    ┌─ SAVE THIS NOW in your password manager. It is shown only once. ─┐')
        say(`    │ BACKUP_PASSPHRASE = ${passphrase}`)
        say('    └─ Without it the backups cannot be opened (docs/api/operations.md, Backups) ─┘')
        say('')
      } else {
        note('BACKUP_PASSPHRASE is already set.')
      }
    } else {
      note('Automatic deploys need an API token that this script cannot create for you:')
      note(
        'create one at https://dash.cloudflare.com/profile/api-tokens (template "Edit Cloudflare Workers", add D1: Edit),'
      )
      note('then run again with CLOUDFLARE_API_TOKEN=<token> pnpm setup:cloud --skip-resend')
    }
  }
}

say(
  '\nDone. Next: commit the change to apps/api/wrangler.jsonc (it contains no secrets) in a pull request.'
)
rl.close()
