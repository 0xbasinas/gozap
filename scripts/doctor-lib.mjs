// Pure helpers for `pnpm doctor` (scripts/doctor.mjs): they read text and return verdicts, so they can be tested
// without any account. Every check returns { status, name, detail?, fix? } with status 'ok' | 'warn' | 'fail' | 'skip'.
import { PREVIEW_DB_PLACEHOLDER } from './setup-cloud-lib.mjs'

const PLACEHOLDER_DB = '00000000-0000-0000-0000-000000000000'

/** The first string value of "KEY": "value" in a wrangler.jsonc text, or null. */
export function configString(text, key) {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`).exec(text)
  return match ? match[1] : null
}

/** Checks that only need the contents of apps/api/wrangler.jsonc. */
export function checkConfig(text, { previewsText = text } = {}) {
  const checks = []
  const databaseId = configString(text, 'database_id')
  checks.push(
    !databaseId || databaseId === PLACEHOLDER_DB
      ? {
          status: 'fail',
          name: 'Database id',
          detail: 'wrangler.jsonc still has the placeholder database_id',
          fix: 'Run pnpm setup:cloud (or paste the id printed by wrangler d1 create)'
        }
      : { status: 'ok', name: 'Database id' }
  )
  const url = configString(text, 'BETTER_AUTH_URL')
  let host = ''
  try {
    host = new URL(url ?? '').hostname
  } catch {
    // reported below
  }
  checks.push(
    !host || host === 'localhost' || host === '127.0.0.1'
      ? {
          status: 'fail',
          name: 'Site address',
          detail: `BETTER_AUTH_URL is ${url ?? 'missing'}, so sign-in links would point at your own computer`,
          fix: 'Run pnpm setup:cloud --url https://your-site (or edit BETTER_AUTH_URL)'
        }
      : { status: 'ok', name: 'Site address', detail: url }
  )
  const from = configString(text, 'EMAIL_FROM')
  checks.push(
    !from || /@example\.com>?$/i.test(from)
      ? {
          status: 'warn',
          name: 'Sender address',
          detail: `EMAIL_FROM is ${from ?? 'missing'}; Resend cannot send from example.com`,
          fix: 'Run pnpm setup:cloud --email-domain your-domain'
        }
      : { status: 'ok', name: 'Sender address', detail: from }
  )
  checks.push(
    previewsText.includes(PREVIEW_DB_PLACEHOLDER)
      ? {
          status: 'warn',
          name: 'Preview database',
          detail: 'pull request previews have no staging database yet',
          fix: 'Run pnpm setup:cloud, then set CLOUDFLARE_DEPLOY=true'
        }
      : { status: 'ok', name: 'Preview database' }
  )
  return checks
}

/** The domain part of "Name <login@example.org>" or "login@example.org". */
export function senderDomain(from) {
  const match = /@([^>\s]+)>?\s*$/.exec(from ?? '')
  return match ? match[1].toLowerCase() : null
}

/** Names of the secrets in `wrangler secret list --format json` output. */
export function secretNames(output) {
  try {
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed.map((s) => s.name).filter(Boolean) : []
  } catch {
    return []
  }
}

const REQUIRED_SECRETS = [
  ['BETTER_AUTH_SECRET', 'fail', 'signs sessions: without it nobody can sign in'],
  ['RESEND_API_KEY', 'fail', 'sends the sign-in emails'],
  ['RESEND_WEBHOOK_SECRET', 'warn', 'lets Resend report bounces and complaints'],
  ['SENTRY_DSN', 'skip', 'optional: reports Worker errors to Sentry']
]

export function checkSecrets(names) {
  return REQUIRED_SECRETS.map(([name, severity, why]) => {
    if (names.includes(name)) return { status: 'ok', name: `Secret ${name}` }
    return {
      status: severity,
      name: `Secret ${name}`,
      detail: `missing (${why})`,
      fix:
        'Run pnpm setup:cloud (it sets every secret) or: pnpm --filter @repo/api exec wrangler secret put ' +
        name
    }
  })
}

/** Names from `gh variable list --json name` / `gh secret list --json name` output. */
export function ghNames(output) {
  try {
    const parsed = JSON.parse(output)
    return Array.isArray(parsed) ? parsed.map((x) => x.name).filter(Boolean) : []
  } catch {
    return []
  }
}

export function checkGitHub({ variables, secrets, variableValues = {} }) {
  const checks = []
  const need = (set, name, label, fix, severity = 'fail') =>
    set.includes(name)
      ? { status: 'ok', name: `${label} ${name}` }
      : { status: severity, name: `${label} ${name}`, detail: 'missing', fix }
  checks.push(
    need(
      variables,
      'API_URL',
      'Variable',
      'Run pnpm setup:cloud (desktop builds need it to find the API)'
    )
  )
  const deploy = variableValues.CLOUDFLARE_DEPLOY
  checks.push(
    deploy === 'true'
      ? {
          status: 'ok',
          name: 'Variable CLOUDFLARE_DEPLOY',
          detail: 'deploys, previews and backups are on'
        }
      : {
          status: 'warn',
          name: 'Variable CLOUDFLARE_DEPLOY',
          detail: 'deploys, previews and backups are off',
          fix: 'gh variable set CLOUDFLARE_DEPLOY --body true'
        }
  )
  if (deploy === 'true') {
    for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
      checks.push(need(secrets, name, 'Secret', 'Run pnpm setup:cloud, or gh secret set ' + name))
    }
    checks.push(
      need(
        secrets,
        'BACKUP_PASSPHRASE',
        'Secret',
        'Backups refuse to run without it: see docs/api/operations.md (Backups)',
        'warn'
      )
    )
  }
  return checks
}

/** The TXT records of a domain, as flat strings (resolveTxt returns chunks). */
export const flattenTxt = (records) => records.map((chunks) => chunks.join(''))

/** SPF / DMARC / DKIM verdicts for the sending domain, from the TXT records found for each name. */
export function checkEmailDns({ domain, root, dmarc, dkim }) {
  const has = (records, prefix) => records.some((r) => r.toLowerCase().startsWith(prefix))
  return [
    has(dmarc, 'v=dmarc1')
      ? { status: 'ok', name: `DMARC for ${domain}` }
      : {
          status: 'warn',
          name: `DMARC for ${domain}`,
          detail: `no TXT record at _dmarc.${domain}`,
          fix: 'Run pnpm setup:cloud (it adds a monitoring-only record)'
        },
    has(dkim, 'p=')
      ? { status: 'ok', name: `DKIM for ${domain}` }
      : {
          status: 'fail',
          name: `DKIM for ${domain}`,
          detail: 'no Resend signing key found, so mail may land in spam',
          fix: 'Verify the domain in Resend and add its DNS records (pnpm setup:cloud does this)'
        },
    root.length === 0
      ? {
          status: 'skip',
          name: `Domain ${domain}`,
          detail: 'no TXT records at all (that is fine for a subdomain)'
        }
      : { status: 'ok', name: `Domain ${domain}` }
  ]
}

/** Verdict on the deployed site's /api/health answer. */
export function checkHealth(url, { status, body, error }) {
  if (error)
    return {
      status: 'fail',
      name: 'Deployed health',
      detail: `${url}/api/health did not answer (${error})`,
      fix: 'Deploy with pnpm --filter @repo/api deploy, or check the domain and its DNS'
    }
  if (status === 200 && /"ok"\s*:\s*true/.test(body ?? ''))
    return { status: 'ok', name: 'Deployed health', detail: `${url}/api/health` }
  return {
    status: 'fail',
    name: 'Deployed health',
    detail: `${url}/api/health answered ${status}`,
    fix: 'Look at the Worker log: pnpm --filter @repo/api exec wrangler tail'
  }
}

const ICON = { ok: '✔', warn: '!', fail: '✘', skip: '-' }

export function formatChecks(checks) {
  return checks
    .map((c) => {
      const line = `  ${ICON[c.status]} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`
      return c.fix && c.status !== 'ok' ? `${line}\n      → ${c.fix}` : line
    })
    .join('\n')
}

/** Exit code: 1 only when something that breaks the product is wrong. Warnings and skips do not fail. */
export const exitCode = (checks) => (checks.some((c) => c.status === 'fail') ? 1 : 0)
