#!/usr/bin/env node
// `pnpm doctor`: checks the whole cloud setup (config, Cloudflare login, secrets, DNS for email, GitHub variables,
// the deployed site) and says what is wrong and how to fix it. It only reads: nothing is created or changed, and
// secret values are never shown (only their names). See docs/setup-cloud.md.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolveTxt } from 'node:dns/promises'
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

const isWindows = process.platform === 'win32'
const CONFIG_PATH = 'apps/api/wrangler.jsonc'

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', shell: isWindows, timeout: 60_000 })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}`, err: `${r.stderr ?? ''}` }
}
const wrangler = (args) => run('pnpm', ['--filter', '@repo/api', 'exec', 'wrangler', ...args])
const txt = async (name) => {
  try {
    return flattenTxt(await resolveTxt(name))
  } catch {
    return []
  }
}

const sections = []
const section = (title, checks) => sections.push({ title, checks })

// 1. The configuration file ---------------------------------------------------------------------------------------------
const config = readFileSync(CONFIG_PATH, 'utf8')
section('Configuration (apps/api/wrangler.jsonc)', checkConfig(config))
const siteUrl = configString(config, 'BETTER_AUTH_URL') ?? ''
const placeholderDb = /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(configString(config, 'database_id') ?? '')

// 2. Cloudflare ---------------------------------------------------------------------------------------------------------
const cloud = []
const who = wrangler(['whoami'])
if (!who.ok || /not authenticated/i.test(who.out)) {
  cloud.push({
    status: 'fail',
    name: 'Cloudflare login',
    detail: 'wrangler is not logged in',
    fix: 'Run pnpm --filter @repo/api exec wrangler login (or set CLOUDFLARE_API_TOKEN)'
  })
} else {
  cloud.push({ status: 'ok', name: 'Cloudflare login' })
  if (placeholderDb) {
    cloud.push({
      status: 'skip',
      name: 'Worker secrets',
      detail: 'no database yet, so no Worker either'
    })
  } else {
    const listed = wrangler(['secret', 'list', '--format', 'json'])
    if (listed.ok) cloud.push(...checkSecrets(secretNames(listed.out)))
    else
      cloud.push({
        status: 'warn',
        name: 'Worker secrets',
        detail: 'could not list them (the Worker may not be deployed yet)',
        fix: 'Run pnpm setup:cloud'
      })
  }
}
section('Cloudflare', cloud)

// 3. Email --------------------------------------------------------------------------------------------------------------
const domain = senderDomain(configString(config, 'EMAIL_FROM'))
if (domain && domain !== 'example.com') {
  section(
    'Email DNS',
    checkEmailDns({
      domain,
      root: await txt(domain),
      dmarc: await txt(`_dmarc.${domain}`),
      dkim: await txt(`resend._domainkey.${domain}`)
    })
  )
} else {
  section('Email DNS', [
    { status: 'skip', name: 'Email DNS', detail: 'no sending domain configured yet' }
  ])
}

// 4. GitHub -------------------------------------------------------------------------------------------------------------
if (run('gh', ['--version']).ok) {
  const vars = run('gh', ['variable', 'list', '--json', 'name,value'])
  const secrets = run('gh', ['secret', 'list', '--json', 'name'])
  if (vars.ok && secrets.ok) {
    const parsed = JSON.parse(vars.out || '[]')
    section(
      'GitHub (repository variables and secrets)',
      checkGitHub({
        variables: ghNames(vars.out),
        secrets: ghNames(secrets.out),
        variableValues: Object.fromEntries(parsed.map((v) => [v.name, v.value]))
      })
    )
  } else {
    section('GitHub (repository variables and secrets)', [
      {
        status: 'skip',
        name: 'GitHub',
        detail: 'gh is not logged in or this folder has no GitHub remote',
        fix: 'gh auth login'
      }
    ])
  }
} else {
  section('GitHub (repository variables and secrets)', [
    { status: 'skip', name: 'GitHub', detail: 'the gh command is not installed' }
  ])
}

// 5. The deployed site --------------------------------------------------------------------------------------------------
if (/^https:/.test(siteUrl)) {
  let result
  try {
    const res = await fetch(`${siteUrl}/api/health`, { signal: AbortSignal.timeout(10_000) })
    result = { status: res.status, body: await res.text() }
  } catch (error) {
    result = { error: error instanceof Error ? error.message : String(error) }
  }
  section('Deployed site', [checkHealth(siteUrl, result)])
} else {
  section('Deployed site', [
    { status: 'skip', name: 'Deployed health', detail: 'not deployed yet' }
  ])
}

// Report ----------------------------------------------------------------------------------------------------------------
const all = sections.flatMap((s) => s.checks)
for (const { title, checks } of sections) console.log(`\n${title}\n${formatChecks(checks)}`)
const count = (status) => all.filter((c) => c.status === status).length
console.log(
  `\n${count('ok')} ok, ${count('warn')} to look at, ${count('fail')} broken, ${count('skip')} skipped.`
)
process.exit(exitCode(all))
