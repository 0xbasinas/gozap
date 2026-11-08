// Pure helpers for scripts/setup-cloud.mjs. Nothing here touches the network or the disk, so it can be tested.
import { randomBytes } from 'node:crypto'

/** Secrets are long random strings; 32 bytes of randomness as base64url. */
export function generateSecret() {
  return randomBytes(32).toString('base64url')
}

export function parseArgs(argv) {
  const out = { flags: new Set(), values: {} }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument: ${arg}`)
    const key = arg.slice(2)
    if (['url', 'email-domain', 'from-name'].includes(key)) {
      const value = argv[++i]
      if (!value || value.startsWith('--')) throw new Error(`--${key} needs a value`)
      out.values[key] = value
    } else if (
      ['skip-resend', 'skip-github', 'skip-deploy', 'rotate-secret', 'yes', 'help'].includes(key)
    ) {
      out.flags.add(key)
    } else {
      throw new Error(`Unknown option: --${key}`)
    }
  }
  return out
}

/** "https://app.example.com/" -> "https://app.example.com". Only https (or localhost for tests) is accepted. */
export function normalizeSiteUrl(input) {
  let url
  try {
    url = new URL(input)
  } catch {
    throw new Error(`"${input}" is not a web address. Use something like https://app.example.com`)
  }
  const local = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local)
    throw new Error('The site address must start with https://')
  return url.origin
}

export const isWorkersDev = (host) => host.endsWith('.workers.dev')

const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

export function assertDomain(name) {
  if (!DOMAIN.test(name)) throw new Error(`"${name}" is not a domain name like example.com`)
  return name
}

/** "My App", "example.com" -> `My App <login@example.com>` */
export function fromAddress(displayName, domain) {
  const safe = displayName.replace(/[<>"\r\n]/g, '').trim() || 'App'
  return `${safe} <login@${domain}>`
}

/**
 * Edit apps/api/wrangler.jsonc in place without losing its comments.
 * Every placeholder is replaced by a single targeted substitution; a missing one is an error, not a silent skip.
 */
export function patchWorkerName(text, name) {
  if (!/"name":\s*"[^"]*"/.test(text)) throw new Error('No Worker "name" line to update')
  return text
    .replace(/("name":\s*)"[^"]*"/, () => `"name": ${JSON.stringify(name)}`)
    .replace(
      /("database_name":\s*)"(?![^"]*-preview")[^"]*"/,
      () => `"database_name": ${JSON.stringify(name)}`
    )
}

export function patchWranglerConfig(text, { databaseId, siteUrl, from, appName, routeHost }) {
  const swap = (source, pattern, replacement, label) => {
    if (!pattern.test(source)) throw new Error(`wrangler.jsonc has no ${label} line to update`)
    return source.replace(pattern, replacement)
  }
  let out = text
  if (databaseId) {
    out = swap(out, /("database_id":\s*)"[^"]*"/, `$1"${databaseId}"`, 'database_id')
  }
  if (siteUrl) {
    out = swap(out, /("BETTER_AUTH_URL":\s*)"[^"]*"/, `$1"${siteUrl}"`, 'BETTER_AUTH_URL')
  }
  if (from) {
    out = swap(
      out,
      /("EMAIL_FROM":\s*)"[^"]*"/,
      () => `"EMAIL_FROM": ${JSON.stringify(from)}`,
      'EMAIL_FROM'
    )
  }
  if (appName) {
    // Every APP_NAME line (production and previews).
    if (!/"APP_NAME"\s*:/.test(out))
      throw new Error('wrangler.jsonc has no APP_NAME line to update')
    out = out.replace(/("APP_NAME":\s*)"[^"]*"/g, () => `"APP_NAME": ${JSON.stringify(appName)}`)
  }
  if (routeHost !== undefined) {
    const routes = routeHost
      ? `[{ "pattern": ${JSON.stringify(routeHost)}, "custom_domain": true }]`
      : '[]'
    out = swap(out, /("routes":\s*)\[[^\]]*\]/, `$1${routes}`, 'routes')
  }
  return out
}

/** Placeholder id of the shared preview database in wrangler.jsonc and wrangler.preview-migrations.jsonc. */
export const PREVIEW_DB_PLACEHOLDER = '00000000-0000-0000-0000-000000000001'

/** Point the preview database entry (name ending in "-preview", placeholder id) at the real database. */
export function patchPreviewDatabase(text, { name, id }) {
  if (!text.includes(PREVIEW_DB_PLACEHOLDER) && !text.includes(id))
    throw new Error('No preview database entry found to update')
  return text
    .replace(
      /("database_name":\s*)"[^"]*-preview"/g,
      () => `"database_name": ${JSON.stringify(name)}`
    )
    .replaceAll(PREVIEW_DB_PLACEHOLDER, id)
}

/**
 * The id of the database called `name` in `wrangler d1 list --json` output, or null. Looked up by name in the account
 * list because `wrangler d1 info <name>` reads wrangler.jsonc first and fails while it still has the placeholder id.
 */
export function findDatabaseId(output, name) {
  const start = output.indexOf('[')
  if (start < 0) return null
  try {
    const rows = JSON.parse(output.slice(start))
    const row = rows.find((r) => r.name === name)
    return row?.uuid ?? row?.database_id ?? null
  } catch {
    return null
  }
}

/** Read the id of a D1 database out of `wrangler d1 info --json` / `d1 create` output. */
export function parseDatabaseId(output) {
  const match = /"?(?:database_id|uuid)"?\s*[:=]\s*"([0-9a-f]{8}-[0-9a-f-]{27})"/i.exec(output)
  return match ? match[1] : null
}

/** Resend lists DNS names relative to the domain ("send", "resend._domainkey"); Cloudflare wants them in full. */
export function toCloudflareRecords(resendRecords, domain) {
  return resendRecords.map((r) => {
    const name = !r.name || r.name === '@' ? domain : `${r.name}.${domain}`
    const record = {
      type: r.type,
      name,
      content: r.value,
      // 1 means "automatic" in Cloudflare; Resend says "Auto".
      ttl: typeof r.ttl === 'number' ? r.ttl : 1
    }
    if (r.type === 'MX') record.priority = r.priority ?? 10
    // These must be DNS-only: a proxied record would hide the mail server.
    if (['CNAME'].includes(r.type)) record.proxied = false
    return record
  })
}

/** True when Cloudflare already holds an identical record, so re-running the setup adds nothing twice. */
export function recordExists(existing, wanted) {
  return existing.some(
    (e) =>
      e.type === wanted.type &&
      e.name.toLowerCase() === wanted.name.toLowerCase() &&
      normalizeContent(e.content) === normalizeContent(wanted.content)
  )
}

const normalizeContent = (s) => String(s).replace(/^"|"$/g, '').replace(/\.$/, '').trim()

/** .env style file for `wrangler deploy --secrets-file`. JSON is also accepted, and avoids quoting problems. */
export function secretsFileContent(secrets) {
  return JSON.stringify(secrets)
}

/** Hide a secret in anything we print: keep the first four characters to help the user recognise it. */
export function mask(value) {
  return value.length <= 8 ? '****' : `${value.slice(0, 4)}…`
}

/** A Sentry DSN looks like https://<key>@<host>/<project id>. Anything else is refused before it is stored as a secret. */
export function isSentryDsn(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username !== '' && /^\/\d+$/.test(url.pathname)
  } catch {
    return false
  }
}

/**
 * A starter DMARC policy. `p=none` only asks receivers to report, it never rejects mail, so it cannot break anything.
 * Gmail and Yahoo expect a DMARC record from anyone who sends email. Tighten it later (p=quarantine, then p=reject)
 * once the reports show only your own mail.
 */
export function dmarcRecord(domain) {
  return { type: 'TXT', name: `_dmarc.${domain}`, content: 'v=DMARC1; p=none;', ttl: 1 }
}

/** The address Resend should call with bounces and complaints, or null when the site is not public yet. */
export function webhookEndpoint(siteUrl) {
  const url = new URL(siteUrl)
  if (url.protocol !== 'https:') return null
  return `${url.origin}/api/webhooks/resend`
}

export const WEBHOOK_EVENTS = ['email.bounced', 'email.complained']
