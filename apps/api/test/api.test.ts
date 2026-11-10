import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'
import { createDb } from '../src/db'
import { deleteDueAccounts } from '../src/deletion'
import { pruneSignIns } from '../src/signIns'
import { soloTeamsDeletion } from '../src/teams'
import worker from '../src/index'
import type { Bindings } from '../src/env'
import type { EmailMessage } from '../src/email'

const bindings = env as unknown as Bindings
const ORIGIN = bindings.BETTER_AUTH_URL

let nextIp = 1

/** An app whose emails are collected instead of sent. Each setup() is a different client IP, so rate limits do not leak between tests. */
function setup(overrides: Partial<Bindings> = {}) {
  const ip = `10.0.${Math.floor(nextIp / 250)}.${nextIp++ % 250}`
  const sent: EmailMessage[] = []
  const app = createApp({
    flagCacheMs: 0,
    emailSender: () => ({ send: async (m) => void sent.push(m) })
  })
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers)
    headers.set('cf-connecting-ip', ip)
    if (init.method && init.method !== 'GET' && !headers.has('origin'))
      headers.set('origin', ORIGIN)
    const ctx = createExecutionContext()
    const response = await app.fetch(
      new Request(`${ORIGIN}${path}`, { ...init, headers, redirect: 'manual' }),
      { ...bindings, ...overrides },
      ctx
    )
    await waitOnExecutionContext(ctx)
    return response
  }
  return { sent, call }
}

/** Runs the whole magic-link flow and returns the session cookie. */
async function signIn(
  s: ReturnType<typeof setup>,
  email: string,
  userAgent?: string
): Promise<string> {
  const agent: Record<string, string> = userAgent ? { 'user-agent': userAgent } : {}
  const before = s.sent.length
  const request = await s.call('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...agent },
    body: JSON.stringify({ email, callbackURL: '/app' })
  })
  expect(request.status).toBe(200)
  expect(s.sent.length).toBe(before + 1)
  const message = s.sent[before]!
  expect(message.to).toBe(email)
  const link = /https?:\/\/\S+magic-link\/verify\S+/.exec(message.text)?.[0]
  expect(link).toBeTruthy()

  const verify = await s.call(new URL(link!).pathname + new URL(link!).search, {
    headers: agent
  })
  expect(verify.status).toBe(302)
  expect(verify.headers.get('location')).toContain('/app')
  const cookies = verify.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  expect(cookies).toContain('session_token')
  return cookies
}

describe('api', () => {
  it('answers the health check and unknown routes', async () => {
    const s = setup()
    expect(await (await s.call('/api/health')).json()).toEqual({ ok: true })
    const missing = await s.call('/api/nope')
    expect(missing.status).toBe(404)
  })

  it('sets security headers', async () => {
    const response = await setup().call('/api/health')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('refuses private data without a session', async () => {
    const s = setup()
    expect((await s.call('/api/preferences')).status).toBe(401)
    const put = await s.call('/api/preferences', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences: { theme: 'dark' }, updatedAt: 1 })
    })
    expect(put.status).toBe(401)
  })
})

describe('sign-in with a magic link', () => {
  it('signs a new user in and gives them a session', async () => {
    const s = setup()
    const cookie = await signIn(s, 'ada@example.com')
    const session = await s.call('/api/auth/get-session', { headers: { cookie } })
    const body = (await session.json()) as { user: { email: string } }
    expect(body.user.email).toBe('ada@example.com')
  })

  it('names the product in the email with APP_NAME, or the default when it is not set', async () => {
    const named = setup({ APP_NAME: 'GoZap' })
    await named.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'name@example.com', callbackURL: '/app' })
    })
    expect(named.sent[0]!.subject).toBe('Sign in to GoZap')

    const plain = setup({ APP_NAME: undefined })
    await plain.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'plain@example.com', callbackURL: '/app' })
    })
    expect(plain.sent[0]!.subject).toBe('Sign in to Electron Desktop Template')
  })

  it('cannot use the same link twice', async () => {
    const s = setup()
    await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'once@example.com', callbackURL: '/app' })
    })
    const link = /https?:\/\/\S+magic-link\/verify\S+/.exec(s.sent[0]!.text)![0]
    const path = new URL(link).pathname + new URL(link).search
    expect((await s.call(path)).status).toBe(302)
    const second = await s.call(path)
    expect(second.headers.get('location') ?? '').toMatch(/error/i)
    expect(second.headers.getSetCookie().join(';')).not.toContain('session_token')
  })

  it('sends no link without a solved challenge when Turnstile is set up, and says so to the page', async () => {
    const s = setup({ TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_SITE_KEY: 'site' })
    const response = await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'bot@example.com', callbackURL: '/app' })
    })
    expect(response.status).toBe(400)
    expect(s.sent).toHaveLength(0)
    const config = await s.call('/api/app-config')
    expect(await config.json()).toEqual({ minimumVersion: null, turnstileSiteKey: 'site' })
  })

  it('asks for no challenge unless both Turnstile keys are set', async () => {
    const s = setup({ TURNSTILE_SITE_KEY: 'site' })
    expect(await (await s.call('/api/app-config')).json()).toEqual({
      minimumVersion: null,
      turnstileSiteKey: null
    })
    await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'human@example.com', callbackURL: '/app' })
    })
    expect(s.sent).toHaveLength(1)
  })

  it('rejects a malformed email', async () => {
    const s = setup()
    const response = await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' })
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(s.sent).toHaveLength(0)
  })

  it('rejects sign-in requests from another origin', async () => {
    const s = setup()
    const response = await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ email: 'x@example.com' })
    })
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(s.sent).toHaveLength(0)
  })
})

describe('desktop sign-in (system browser, PKCE)', () => {
  const b64url = (bytes: Uint8Array): string =>
    btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replace(/=+$/, '')
  const linkIn = (text: string): string => /https?:\/\/\S+magic-link\/verify\S+/.exec(text)![0]

  it('hands the desktop app a one-time code that it can exchange for its own session', async () => {
    const s = setup()
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)))
    const challenge = b64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
    )
    const state = 'stateABC123'
    const query = new URLSearchParams({ client_id: 'electron', code_challenge: challenge, state })

    // The sign-in page forwards the desktop parameters with the magic-link request.
    const request = await s.call(`/api/auth/sign-in/magic-link?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'desk@example.com', callbackURL: '/auth/desktop' })
    })
    expect(request.status).toBe(200)
    const transfer = request.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    expect(transfer).toContain('transfer_token')

    // The emailed link is opened in the same browser, so it carries the transfer cookie.
    const link = linkIn(s.sent[0]!.text)
    const verify = await s.call(new URL(link).pathname + new URL(link).search, {
      headers: { cookie: transfer }
    })
    expect(verify.status).toBe(302)
    const redirectCookie = verify.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .find((c) => c.startsWith('better-auth.electron='))
    expect(redirectCookie).toBeTruthy()
    const { identifier, state: returnedState } = JSON.parse(
      atob(decodeURIComponent(redirectCookie!.split('=')[1]!).replace(/-/g, '+').replace(/_/g, '/'))
    ) as { identifier: string; state: string }
    expect(returnedState).toBe(state)

    // The desktop app exchanges the code (with its secret verifier) for a session. Its origin is the app scheme.
    const exchange = await s.call('/api/auth/electron/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'electron-desktop-template:/' },
      body: JSON.stringify({ token: identifier, state, code_verifier: verifier })
    })
    expect(exchange.status).toBe(200)
    const body = (await exchange.json()) as { user: { email: string } }
    expect(body.user.email).toBe('desk@example.com')
    expect(exchange.headers.getSetCookie().join(';')).toContain('session_token')

    // The code works once.
    const again = await s.call('/api/auth/electron/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'electron-desktop-template:/' },
      body: JSON.stringify({ token: identifier, state, code_verifier: verifier })
    })
    expect(again.status).toBeGreaterThanOrEqual(400)
  })

  it('refuses a wrong code verifier', async () => {
    const s = setup()
    const challenge = b64url(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('right')))
    )
    const query = new URLSearchParams({
      client_id: 'electron',
      code_challenge: challenge,
      state: 'st'
    })
    const request = await s.call(`/api/auth/sign-in/magic-link?${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'pkce@example.com', callbackURL: '/auth/desktop' })
    })
    const transfer = request.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    const link = linkIn(s.sent[0]!.text)
    const verify = await s.call(new URL(link).pathname + new URL(link).search, {
      headers: { cookie: transfer }
    })
    const cookie = verify.headers
      .getSetCookie()
      .map((c) => c.split(';')[0]!)
      .find((c) => c.startsWith('better-auth.electron='))!
    const { identifier } = JSON.parse(
      atob(decodeURIComponent(cookie.split('=')[1]!).replace(/-/g, '+').replace(/_/g, '/'))
    ) as { identifier: string }
    const exchange = await s.call('/api/auth/electron/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'electron-desktop-template:/' },
      body: JSON.stringify({ token: identifier, state: 'st', code_verifier: 'wrong' })
    })
    expect(exchange.status).toBe(400)
  })
})

describe('rate limiting', () => {
  it('slows down repeated sign-in requests from one address', async () => {
    const s = setup()
    const attempt = (): Promise<Response> =>
      s.call('/api/auth/sign-in/magic-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'spam@example.com', callbackURL: '/app' })
      })
    const statuses: number[] = []
    for (let i = 0; i < 8; i++) statuses.push((await attempt()).status)
    expect(statuses).toContain(429)
    expect(s.sent.length).toBeLessThan(8)
  })
})

describe('account', () => {
  const json = (cookie: string, method: string, body?: unknown): RequestInit => ({
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })

  it('needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/account')).status).toBe(401)
    expect((await s.call('/api/account/export')).status).toBe(401)
    expect(
      (await s.call('/api/account', json('', 'DELETE', { confirmEmail: 'x@example.com' }))).status
    ).toBe(401)
  })

  it('shows the account and exports everything held about it, without tokens', async () => {
    const s = setup()
    const cookie = await signIn(s, 'zed@example.com')
    await s.call(
      '/api/preferences',
      json(cookie, 'PUT', { preferences: { theme: 'dark' }, updatedAt: 7 })
    )

    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      email: string
    }
    expect(me.email).toBe('zed@example.com')

    const response = await s.call('/api/account/export', { headers: { cookie } })
    expect(response.headers.get('content-disposition')).toContain('attachment')
    const text = await response.text()
    const data = JSON.parse(text) as {
      preferences: { preferences: { theme: string } }
      sessions: unknown[]
    }
    expect(data.preferences.preferences.theme).toBe('dark')
    expect(data.sessions).toHaveLength(1)
    expect(text).not.toMatch(/token/i)
  })

  it("exports only the caller's own data", async () => {
    const s = setup()
    const a = await signIn(s, 'a1@example.com')
    const b = await signIn(s, 'b1@example.com')
    await s.call(
      '/api/preferences',
      json(a, 'PUT', { preferences: { theme: 'dark' }, updatedAt: 7 })
    )
    const data = (await (
      await s.call('/api/account/export', { headers: { cookie: b } })
    ).json()) as {
      preferences: unknown
    }
    expect(data.preferences).toEqual({
      preferences: { theme: 'system', accent: 'neutral' },
      updatedAt: 0
    })
  })

  it('blocks cross-site writes (CSRF)', async () => {
    const s = setup()
    const cookie = await signIn(s, 'csrf@example.com')
    const response = await s.call('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ preferences: { theme: 'dark' }, updatedAt: 1 })
    })
    expect(response.status).toBe(403)
  })

  it('refuses to delete without the matching email', async () => {
    const s = setup()
    const cookie = await signIn(s, 'keep@example.com')
    const wrong = await s.call(
      '/api/account',
      json(cookie, 'DELETE', { confirmEmail: 'other@example.com' })
    )
    expect(wrong.status).toBe(400)
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)
  })

  it('removes the account and everything held about it once the cooling-off period is over', async () => {
    const s = setup()
    const cookie = await signIn(s, 'gone@example.com')
    await bindings.DB.prepare(
      "INSERT INTO passkey (id, name, public_key, user_id, credential_id, counter, device_type, backed_up) VALUES ('pk1', 'laptop', 'k', (SELECT id FROM user WHERE email = ?), 'cred1', 0, 'singleDevice', 0)"
    )
      .bind('gone@example.com')
      .run()
    await s.call(
      '/api/preferences',
      json(cookie, 'PUT', { preferences: { theme: 'dark' }, updatedAt: 5 })
    )
    const userId = (await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('gone@example.com')
      .first<{ id: string }>())!.id

    const cross = await s.call('/api/account', {
      ...json(cookie, 'DELETE', { confirmEmail: 'gone@example.com' }),
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' }
    })
    expect(cross.status).toBe(403)

    const asked = await s.call(
      '/api/account',
      json(cookie, 'DELETE', { confirmEmail: 'gone@example.com' })
    )
    expect(asked.status).toBe(202)
    // Nothing is removed yet: the person can still sign in and see the date.
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)

    const db = createDb(bindings.DB)
    expect(await deleteDueAccounts(db, Date.now() + 13 * 86_400_000)).toBe(0)
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)
    expect(await deleteDueAccounts(db, Date.now() + 15 * 86_400_000)).toBe(1)

    // The old cookie is dead at once (not after the 5-minute cache), and nothing is left in the database.
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(401)
    const left = async (table: string, column: string): Promise<number | undefined> =>
      (
        await bindings.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
          .bind(userId)
          .first<{ n: number }>()
      )?.n
    expect(await left('user', 'id')).toBe(0)
    expect(await left('session', 'user_id')).toBe(0)
    expect(await left('passkey', 'user_id')).toBe(0)
    expect(await left('preference', 'user_id')).toBe(0)
    expect(await left('account_deletion', 'user_id')).toBe(0)
  })

  it('schedules the deletion, tells the person by email, and asking twice changes nothing', async () => {
    const s = setup()
    const cookie = await signIn(s, 'plan@example.com')
    const before = s.sent.length
    const first = (await (
      await s.call('/api/account', json(cookie, 'DELETE', { confirmEmail: 'plan@example.com' }))
    ).json()) as { scheduledFor: string }
    const days = (Date.parse(first.scheduledFor) - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9)
    expect(days).toBeLessThan(14.1)

    expect(s.sent.length).toBe(before + 1)
    const mail = s.sent[before]!
    expect(mail.to).toBe('plan@example.com')
    expect(mail.text).toMatch(/\/account\/cancel-deletion\?token=\S{20,}/)

    const second = (await (
      await s.call('/api/account', json(cookie, 'DELETE', { confirmEmail: 'plan@example.com' }))
    ).json()) as { scheduledFor: string }
    expect(second.scheduledFor).toBe(first.scheduledFor)
    expect(s.sent.length).toBe(before + 1)

    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      deletionScheduledFor: string | null
    }
    expect(me.deletionScheduledFor).toBe(first.scheduledFor)
    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as { account: { deletionScheduledFor: string | null } }
    expect(exported.account.deletionScheduledFor).toBe(first.scheduledFor)
  })

  it('can be cancelled while signed in', async () => {
    const s = setup()
    const cookie = await signIn(s, 'stay1@example.com')
    await s.call('/api/account', json(cookie, 'DELETE', { confirmEmail: 'stay1@example.com' }))
    expect((await s.call('/api/account/deletion/cancel', json(cookie, 'POST'))).status).toBe(204)
    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      deletionScheduledFor: string | null
    }
    expect(me.deletionScheduledFor).toBeNull()
    await deleteDueAccounts(createDb(bindings.DB), Date.now() + 30 * 86_400_000)
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)
  })

  it('can be cancelled from the email link without signing in, once', async () => {
    const s = setup()
    const cookie = await signIn(s, 'stay2@example.com')
    const before = s.sent.length
    await s.call('/api/account', json(cookie, 'DELETE', { confirmEmail: 'stay2@example.com' }))
    const token = /token=(\S+)/.exec(s.sent[before]!.text)![1]!

    const post = (t: string): Promise<Response> =>
      s.call('/api/account/deletion/cancel-with-token', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: t })
      })
    expect((await post('x'.repeat(43))).status).toBe(404)
    expect((await post('short')).status).toBe(400)
    expect((await post(token)).status).toBe(204)
    expect((await post(token)).status).toBe(404)
    await deleteDueAccounts(createDb(bindings.DB), Date.now() + 30 * 86_400_000)
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)
  })

  it("keeps a team's company sign-in when the person who set it up is deleted", async () => {
    const s = setup()
    await signIn(s, 'setup-owner@example.com')
    await signIn(s, 'setup-admin@example.com')
    await signIn(s, 'setup-solo@example.com')
    const db = bindings.DB
    const id = async (email: string): Promise<string> =>
      (await db.prepare('SELECT id FROM user WHERE email = ?').bind(email).first<{ id: string }>())!
        .id
    const [owner, admin, solo] = [
      await id('setup-owner@example.com'),
      await id('setup-admin@example.com'),
      await id('setup-solo@example.com')
    ]
    const now = Date.now()
    const insert = async (sql: string, ...v: unknown[]): Promise<void> => {
      await db
        .prepare(sql)
        .bind(...v)
        .run()
    }
    await insert(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('t-shared', 'Shared', 't-shared', ?)",
      now
    )
    await insert(
      "INSERT INTO organization (id, name, slug, created_at) VALUES ('t-solo', 'Solo', 't-solo', ?)",
      now
    )
    await insert(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m1', 't-shared', ?, 'owner', ?)",
      owner,
      now
    )
    await insert(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m2', 't-shared', ?, 'admin', ?)",
      admin,
      now
    )
    await insert(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) VALUES ('m3', 't-solo', ?, 'owner', ?)",
      solo,
      now
    )
    await insert(
      "INSERT INTO sso_provider (id, issuer, user_id, provider_id, organization_id, domain) VALUES ('p1', 'https://idp.a', ?, 'prov-shared', 't-shared', 'a.example')",
      owner
    )
    await insert(
      "INSERT INTO sso_provider (id, issuer, user_id, provider_id, organization_id, domain) VALUES ('p2', 'https://idp.b', ?, 'prov-solo', 't-solo', 'b.example')",
      solo
    )
    await insert(
      "INSERT INTO account_deletion (user_id, requested_at, scheduled_for, cancel_token_hash) VALUES (?, ?, ?, 'x')",
      owner,
      now - 2000,
      now - 1000
    )
    await insert(
      "INSERT INTO account_deletion (user_id, requested_at, scheduled_for, cancel_token_hash) VALUES (?, ?, ?, 'x')",
      solo,
      now - 2000,
      now - 1000
    )

    expect(await deleteDueAccounts(createDb(db), now)).toBe(2)
    const kept = await db
      .prepare('SELECT user_id FROM sso_provider WHERE provider_id = ?')
      .bind('prov-shared')
      .first<{ user_id: string }>()
    expect(kept?.user_id).toBe(admin)
    expect(
      await db
        .prepare('SELECT id FROM sso_provider WHERE provider_id = ?')
        .bind('prov-solo')
        .first()
    ).toBeNull()
  })

  it('does not let a cross-site page cancel with a token', async () => {
    const s = setup()
    const response = await s.call('/api/account/deletion/cancel-with-token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ token: 'x'.repeat(43) })
    })
    expect(response.status).toBe(403)
  })
})

describe('passkeys', () => {
  it('offers a challenge for the site domain to anyone, and keeps the list private', async () => {
    const s = setup()
    const options = await s.call('/api/auth/passkey/generate-authenticate-options')
    expect(options.status).toBe(200)
    const body = (await options.json()) as { challenge: string; rpId?: string }
    expect(body.challenge).toBeTruthy()
    expect(body.rpId).toBe(new URL(ORIGIN).hostname)

    expect((await s.call('/api/auth/passkey/list-user-passkeys')).status).toBe(401)
    const cookie = await signIn(s, 'pk@example.com')
    const list = await s.call('/api/auth/passkey/list-user-passkeys', { headers: { cookie } })
    expect(await list.json()).toEqual([])
  })

  it('needs a session to start adding a passkey', async () => {
    const s = setup()
    expect((await s.call('/api/auth/passkey/generate-register-options')).status).toBe(401)
    const cookie = await signIn(s, 'pk2@example.com')
    const ok = await s.call('/api/auth/passkey/generate-register-options', { headers: { cookie } })
    expect(ok.status).toBe(200)
  })
})

describe('preferences', () => {
  const put = (cookie: string, theme: string, updatedAt: number): RequestInit => ({
    method: 'PUT',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ preferences: { theme }, updatedAt })
  })
  const get = async (s: ReturnType<typeof setup>, cookie: string): Promise<unknown> =>
    (await s.call('/api/preferences', { headers: { cookie } })).json()

  it('needs a session and blocks cross-site writes', async () => {
    const s = setup()
    expect((await s.call('/api/preferences')).status).toBe(401)
    const cookie = await signIn(s, 'pref0@example.com')
    const cross = await s.call('/api/preferences', {
      ...put(cookie, 'dark', 5),
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' }
    })
    expect(cross.status).toBe(403)
  })

  it('starts with the defaults and keeps the newest edit', async () => {
    const s = setup()
    const cookie = await signIn(s, 'pref1@example.com')
    expect(await get(s, cookie)).toEqual({
      preferences: { theme: 'system', accent: 'neutral' },
      updatedAt: 0
    })

    const first = await s.call('/api/preferences', put(cookie, 'dark', 100))
    expect(await first.json()).toEqual({
      preferences: { theme: 'dark', accent: 'neutral' },
      updatedAt: 100
    })

    // An older edit from a device that was offline loses, and gets the newer copy back.
    const stale = await s.call('/api/preferences', put(cookie, 'light', 50))
    expect(await stale.json()).toEqual({
      preferences: { theme: 'dark', accent: 'neutral' },
      updatedAt: 100
    })
    expect(await get(s, cookie)).toEqual({
      preferences: { theme: 'dark', accent: 'neutral' },
      updatedAt: 100
    })

    const newer = await s.call('/api/preferences', put(cookie, 'light', 200))
    expect(await newer.json()).toEqual({
      preferences: { theme: 'light', accent: 'neutral' },
      updatedAt: 200
    })
  })

  it('keeps the accent when an older app saves only the theme', async () => {
    const s = setup()
    const cookie = await signIn(s, 'pref-old@example.com')
    const withAccent = await s.call('/api/preferences', {
      method: 'PUT',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ preferences: { theme: 'light', accent: 'blue' }, updatedAt: 100 })
    })
    expect(await withAccent.json()).toEqual({
      preferences: { theme: 'light', accent: 'blue' },
      updatedAt: 100
    })
    // The older app does not know about the accent: its newer theme change must not reset it.
    const older = await s.call('/api/preferences', put(cookie, 'dark', 200))
    expect(await older.json()).toEqual({
      preferences: { theme: 'dark', accent: 'blue' },
      updatedAt: 200
    })
    expect(await get(s, cookie)).toEqual({
      preferences: { theme: 'dark', accent: 'blue' },
      updatedAt: 200
    })
  })

  it('rejects values it does not know', async () => {
    const s = setup()
    const cookie = await signIn(s, 'pref2@example.com')
    expect((await s.call('/api/preferences', put(cookie, 'pink', 5))).status).toBe(400)
    expect((await s.call('/api/preferences', put(cookie, 'dark', -5))).status).toBe(400)
  })

  it('cannot pin a time in the far future, and keeps people apart', async () => {
    const s = setup()
    const a = await signIn(s, 'pref3@example.com')
    const b = await signIn(s, 'pref4@example.com')
    const far = Date.now() + 10 * 365 * 86_400_000
    const saved = (await (await s.call('/api/preferences', put(a, 'dark', far))).json()) as {
      updatedAt: number
    }
    expect(saved.updatedAt).toBeLessThan(Date.now() + 10 * 60_000)
    expect(await get(s, b)).toEqual({
      preferences: { theme: 'system', accent: 'neutral' },
      updatedAt: 0
    })
  })
})

describe('the deployed entry point', () => {
  it('serves requests through the error-reporting wrapper, with or without a Sentry DSN', async () => {
    for (const dsn of [undefined, 'https://public@o0.ingest.sentry.io/0']) {
      const ctx = createExecutionContext()
      const response = await worker.fetch(
        new Request(`${ORIGIN}/api/health`),
        { ...bindings, SENTRY_DSN: dsn } as Bindings,
        ctx
      )
      await waitOnExecutionContext(ctx)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
    }
  })
})

describe('bounces and complaints (Resend webhook)', () => {
  const secret = bindings.RESEND_WEBHOOK_SECRET!
  const b64 = (bytes: ArrayBuffer | Uint8Array): string =>
    btoa(String.fromCharCode(...new Uint8Array(bytes as ArrayBuffer)))

  /** Signs like Svix/Resend: HMAC-SHA256 of "id.timestamp.body" with the base64 part of the secret. */
  async function signedPost(
    s: ReturnType<typeof setup>,
    event: unknown,
    options: { sign?: boolean; timestamp?: number } = {}
  ): Promise<Response> {
    const body = JSON.stringify(event)
    const id = 'msg_' + crypto.randomUUID()
    const timestamp = String(options.timestamp ?? Math.floor(Date.now() / 1000))
    const key = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from(atob(secret.slice('whsec_'.length)), (c) => c.charCodeAt(0)),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const signature = b64(
      await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`))
    )
    return s.call('/api/webhooks/resend', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': options.sign === false ? 'v1,AAAA' : `v1,${signature}`
      },
      body
    })
  }

  const bounce = (to: string, type: string): unknown => ({
    type: 'email.bounced',
    created_at: new Date().toISOString(),
    data: { email_id: 'e1', to: [to], bounce: { type } }
  })
  const requestLink = (s: ReturnType<typeof setup>, email: string): Promise<Response> =>
    s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: '/app' })
    })

  it('refuses unsigned, wrongly signed and stale requests, and is off without a secret', async () => {
    const s = setup()
    expect(
      (await signedPost(s, bounce('x@example.com', 'Permanent'), { sign: false })).status
    ).toBe(400)
    const stale = Math.floor(Date.now() / 1000) - 3600
    expect(
      (await signedPost(s, bounce('x@example.com', 'Permanent'), { timestamp: stale })).status
    ).toBe(400)
    const off = setup({ RESEND_WEBHOOK_SECRET: undefined })
    expect((await signedPost(off, bounce('x@example.com', 'Permanent'))).status).toBe(404)
  })

  it('stops emailing an address after a permanent bounce, and tells nobody that it did', async () => {
    const s = setup()
    expect((await signedPost(s, bounce('Bad@Example.com', 'Permanent'))).status).toBe(200)

    const response = await requestLink(s, 'bad@example.com')
    expect(response.status).toBe(200) // same answer as for any address
    expect(s.sent).toHaveLength(0)

    await requestLink(s, 'good@example.com')
    expect(s.sent.map((m) => m.to)).toEqual(['good@example.com'])
  })

  it('ignores temporary bounces, and suppresses spam complaints', async () => {
    const s = setup()
    await signedPost(s, bounce('full@example.com', 'Transient'))
    await requestLink(s, 'full@example.com')
    expect(s.sent).toHaveLength(1)

    await signedPost(s, { type: 'email.complained', data: { to: ['spam@example.com'] } })
    await requestLink(s, 'spam@example.com')
    expect(s.sent).toHaveLength(1)
  })

  it('tries again after the suppression period', async () => {
    const s = setup()
    await signedPost(s, bounce('old@example.com', 'Permanent'))
    const longAgo = Date.now() - 31 * 86_400_000
    await bindings.DB.prepare('UPDATE email_suppression SET created_at = ? WHERE email = ?')
      .bind(longAgo, 'old@example.com')
      .run()
    await requestLink(s, 'old@example.com')
    expect(s.sent).toHaveLength(1)
  })
})

describe('feedback', () => {
  const send = (cookie: string, body: unknown): RequestInit => ({
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  const good = { kind: 'bug', message: 'The settings window is blank', source: 'web' }

  it('needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/feedback', send('', good))).status).toBe(401)
  })

  it('stores feedback and includes it in the export, without the diagnostics text', async () => {
    const s = setup()
    const cookie = await signIn(s, 'fb1@example.com')
    const response = await s.call(
      '/api/feedback',
      send(cookie, {
        ...good,
        source: 'desktop',
        diagnostics: 'SECRET-REPORT-TEXT',
        platform: 'win32'
      })
    )
    expect(response.status).toBe(201)
    expect(((await response.json()) as { id: string }).id).toBeTruthy()

    const text = await (await s.call('/api/account/export', { headers: { cookie } })).text()
    const data = JSON.parse(text) as { feedback: { message: string; hasDiagnostics: boolean }[] }
    expect(data.feedback).toHaveLength(1)
    expect(data.feedback[0]).toMatchObject({ message: good.message, hasDiagnostics: true })
    expect(text).not.toContain('SECRET-REPORT-TEXT')
  })

  it('rejects bad input', async () => {
    const s = setup()
    const cookie = await signIn(s, 'fb2@example.com')
    for (const body of [
      { ...good, message: '' },
      { ...good, kind: 'rant' },
      { ...good, message: 'x'.repeat(5000) },
      { ...good, diagnostics: 'x'.repeat(30000) }
    ]) {
      expect((await s.call('/api/feedback', send(cookie, body))).status).toBe(400)
    }
  })

  it('limits how much one person can send per hour', async () => {
    const s = setup()
    const cookie = await signIn(s, 'fb3@example.com')
    for (let i = 0; i < 5; i++) {
      expect((await s.call('/api/feedback', send(cookie, good))).status).toBe(201)
    }
    expect((await s.call('/api/feedback', send(cookie, good))).status).toBe(429)
  })

  it('blocks cross-site writes and keeps one person from seeing another’s feedback', async () => {
    const s = setup()
    const a = await signIn(s, 'fb4@example.com')
    const b = await signIn(s, 'fb5@example.com')
    const evil = await s.call('/api/feedback', {
      ...send(a, good),
      headers: { cookie: a, 'content-type': 'application/json', origin: 'https://evil.example' }
    })
    expect(evil.status).toBe(403)
    await s.call('/api/feedback', send(a, good))
    const theirs = (await (
      await s.call('/api/account/export', { headers: { cookie: b } })
    ).json()) as { feedback: unknown[] }
    expect(theirs.feedback).toHaveLength(0)
  })

  it('is deleted with the account', async () => {
    const s = setup()
    const cookie = await signIn(s, 'fb6@example.com')
    await s.call('/api/feedback', send(cookie, good))
    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      id: string
    }
    await s.call('/api/account', {
      method: 'DELETE',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmEmail: 'fb6@example.com' })
    })
    await deleteDueAccounts(createDb(bindings.DB), Date.now() + 15 * 86_400_000)
    const rows = await bindings.DB.prepare('select count(*) as n from feedback where user_id = ?')
      .bind(me.id)
      .first<{ n: number }>()
    expect(rows?.n).toBe(0)
  })
})

describe('devices', () => {
  type Device = { id: string; label: string; nickname: string | null; current: boolean }
  const list = async (s: ReturnType<typeof setup>, cookie: string): Promise<Device[]> =>
    (await (await s.call('/api/devices', { headers: { cookie } })).json()) as Device[]
  const patch = (cookie: string, nickname: unknown): RequestInit => ({
    method: 'PATCH',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ nickname })
  })

  it('needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/devices')).status).toBe(401)
  })

  it('lists every sign-in of the person, with this device first', async () => {
    const s = setup()
    const first = await signIn(s, 'dev1@example.com')
    const second = await signIn(s, 'dev1@example.com')
    const devices = await list(s, second)
    expect(devices).toHaveLength(2)
    expect(devices[0]!.current).toBe(true)
    expect(devices[1]!.current).toBe(false)
    expect(JSON.stringify(devices)).not.toMatch(/token/i)
    // From the other cookie the "current" one is the other entry.
    const fromFirst = await list(s, first)
    expect(fromFirst[0]!.id).not.toBe(devices[0]!.id)
  })

  it('names a device, shows it, and clears it again', async () => {
    const s = setup()
    const cookie = await signIn(s, 'dev2@example.com')
    const [mine] = await list(s, cookie)
    expect((await s.call(`/api/devices/${mine!.id}`, patch(cookie, '  Work laptop '))).status).toBe(
      204
    )
    expect((await list(s, cookie))[0]!.nickname).toBe('Work laptop')
    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as {
      sessions: { nickname: string | null }[]
    }
    expect(exported.sessions[0]!.nickname).toBe('Work laptop')
    expect((await s.call(`/api/devices/${mine!.id}`, patch(cookie, null))).status).toBe(204)
    expect((await list(s, cookie))[0]!.nickname).toBeNull()
  })

  it('rejects a name that is too long', async () => {
    const s = setup()
    const cookie = await signIn(s, 'dev3@example.com')
    const [mine] = await list(s, cookie)
    expect((await s.call(`/api/devices/${mine!.id}`, patch(cookie, 'x'.repeat(41)))).status).toBe(
      400
    )
  })

  it('signs out another device at once, but not the one in use', async () => {
    const s = setup()
    const first = await signIn(s, 'dev4@example.com')
    const second = await signIn(s, 'dev4@example.com')
    const devices = await list(s, second)
    const other = devices.find((d) => !d.current)!
    const me = devices.find((d) => d.current)!

    const self = await s.call(`/api/devices/${me.id}`, {
      method: 'DELETE',
      headers: { cookie: second }
    })
    expect(self.status).toBe(400)

    const gone = await s.call(`/api/devices/${other.id}`, {
      method: 'DELETE',
      headers: { cookie: second }
    })
    expect(gone.status).toBe(204)
    expect((await s.call('/api/account', { headers: { cookie: first } })).status).toBe(401)
    expect((await s.call('/api/account', { headers: { cookie: second } })).status).toBe(200)
    expect(await list(s, second)).toHaveLength(1)
  })

  it("cannot see, rename or sign out another person's devices", async () => {
    const s = setup()
    const a = await signIn(s, 'dev5a@example.com')
    const b = await signIn(s, 'dev5b@example.com')
    const [theirs] = await list(s, a)
    expect(await list(s, b)).toHaveLength(1)
    expect((await list(s, b))[0]!.id).not.toBe(theirs!.id)
    expect((await s.call(`/api/devices/${theirs!.id}`, patch(b, 'Hacked'))).status).toBe(404)
    expect(
      (await s.call(`/api/devices/${theirs!.id}`, { method: 'DELETE', headers: { cookie: b } }))
        .status
    ).toBe(404)
    expect((await s.call('/api/account', { headers: { cookie: a } })).status).toBe(200)
  })

  it('blocks cross-site writes', async () => {
    const s = setup()
    const cookie = await signIn(s, 'dev6@example.com')
    const [mine] = await list(s, cookie)
    const response = await s.call(`/api/devices/${mine!.id}`, {
      method: 'PATCH',
      headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ nickname: 'x' })
    })
    expect(response.status).toBe(403)
  })
})

describe('email change', () => {
  const json = (cookie: string, method: string, body?: unknown): RequestInit => ({
    method,
    headers: { cookie, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const ask = (cookie: string, newEmail: string): RequestInit => json(cookie, 'POST', { newEmail })
  const confirm = (token: string): RequestInit => ({
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  })

  it('sends a link to the new address, and moves the account when it is used, once', async () => {
    const s = setup()
    const cookie = await signIn(s, 'old@example.com')
    const before = s.sent.length
    const asked = await s.call('/api/account/email-change', ask(cookie, 'New@Example.com'))
    expect(asked.status).toBe(202)
    expect(s.sent.length).toBe(before + 1)
    const mail = s.sent[before]!
    expect(mail.to).toBe('new@example.com')
    const token = /token=(\S+)/.exec(mail.text)![1]!

    // Nothing changes until the link is used; the account page shows what is pending.
    const pending = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      email: string
      pendingEmail: string | null
    }
    expect(pending).toMatchObject({ email: 'old@example.com', pendingEmail: 'new@example.com' })

    const done = await s.call('/api/account/email-change/confirm', confirm(token))
    expect(done.status).toBe(200)
    expect(await done.json()).toEqual({ email: 'new@example.com' })
    // The old address is told, and the account now uses the new one.
    expect(s.sent.at(-1)!.to).toBe('old@example.com')
    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      email: string
      pendingEmail: string | null
    }
    expect(me).toMatchObject({ email: 'new@example.com', pendingEmail: null })
    const trail = await bindings.DB.prepare(
      "SELECT type FROM audit_event WHERE type = 'email_changed'"
    ).all()
    expect(trail.results.length).toBeGreaterThanOrEqual(1)
    expect((await s.call('/api/account/email-change/confirm', confirm(token))).status).toBe(404)
  })

  it('refuses the same address, bad input, and asking again within a minute', async () => {
    const s = setup()
    const cookie = await signIn(s, 'same@example.com')
    expect(
      (await s.call('/api/account/email-change', ask(cookie, 'same@example.com'))).status
    ).toBe(400)
    expect((await s.call('/api/account/email-change', ask(cookie, 'not-an-email'))).status).toBe(
      400
    )
    expect((await s.call('/api/account/email-change', ask(cookie, 'a@example.com'))).status).toBe(
      202
    )
    expect((await s.call('/api/account/email-change', ask(cookie, 'b@example.com'))).status).toBe(
      429
    )
  })

  it('answers the same for an address that is taken, and sends nothing', async () => {
    const s = setup()
    await signIn(s, 'taken@example.com')
    const cookie = await signIn(s, 'asker@example.com')
    const before = s.sent.length
    const asked = await s.call('/api/account/email-change', ask(cookie, 'taken@example.com'))
    expect(asked.status).toBe(202)
    expect(s.sent.length).toBe(before)
  })

  it('needs a session to ask, and rejects wrong tokens and cross-site pages', async () => {
    const s = setup()
    expect((await s.call('/api/account/email-change', ask('', 'x@example.com'))).status).toBe(401)
    expect(
      (await s.call('/api/account/email-change/confirm', confirm('x'.repeat(43)))).status
    ).toBe(404)
    expect((await s.call('/api/account/email-change/confirm', confirm('short'))).status).toBe(400)
    const cross = await s.call('/api/account/email-change/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
      body: JSON.stringify({ token: 'x'.repeat(43) })
    })
    expect(cross.status).toBe(403)
  })
})

describe('sign-in activity', () => {
  const CHROME =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36'
  const SAFARI =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'

  it('lists sign-ins, and warns by email only for a browser and system not seen before', async () => {
    const s = setup()
    const cookie = await signIn(s, 'watch@example.com', CHROME)
    const alerts = (): number => s.sent.filter((m) => /New sign-in/.test(m.subject)).length
    expect(alerts()).toBe(0) // the first sign-in is not a surprise

    await signIn(s, 'watch@example.com', CHROME)
    expect(alerts()).toBe(0) // same browser and system

    await signIn(s, 'watch@example.com', SAFARI)
    expect(alerts()).toBe(1)
    const alert = s.sent.find((m) => /New sign-in/.test(m.subject))!
    expect(alert.to).toBe('watch@example.com')
    expect(alert.text).toContain('Safari on macOS')

    const list = (await (
      await s.call('/api/account/sign-ins', { headers: { cookie } })
    ).json()) as {
      label: string
      newDevice: boolean
    }[]
    expect(list.map((e) => e.label)).toEqual(
      expect.arrayContaining(['Chrome on Windows', 'Safari on macOS'])
    )
    expect(list.length).toBe(3)
    expect(list[0]!.newDevice).toBe(true)
    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as {
      signInActivity: unknown[]
    }
    expect(exported.signInActivity.length).toBe(3)
  })

  it('needs a session, and old entries are pruned', async () => {
    const s = setup()
    expect((await s.call('/api/account/sign-ins')).status).toBe(401)
    await signIn(s, 'prune@example.com', CHROME)
    const db = createDb(bindings.DB)
    await pruneSignIns(db, Date.now() + 91 * 86_400_000)
    const left = await bindings.DB.prepare('SELECT COUNT(*) AS n FROM sign_in_event').first<{
      n: number
    }>()
    expect(left?.n).toBe(0)
  })
})

describe('privacy summary', () => {
  it('counts what is held about the person, and needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/account/privacy')).status).toBe(401)
    const cookie = await signIn(s, 'priv@example.com', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0')
    await s.call('/api/feedback', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'idea', message: 'hello there', source: 'web' })
    })
    const summary = (await (
      await s.call('/api/account/privacy', { headers: { cookie } })
    ).json()) as Record<string, unknown>
    expect(summary).toEqual({
      devices: 1,
      signIns: 1,
      securityEvents: 1,
      passkeys: 0,
      feedback: 1,
      hasSyncedSettings: false
    })
  })
})

describe('app config', () => {
  it('says which app version is the oldest allowed, and is public', async () => {
    const none = await setup().call('/api/app-config')
    expect(none.status).toBe(200)
    expect(await none.json()).toEqual({ minimumVersion: null, turnstileSiteKey: null })

    const set = setup({ MIN_APP_VERSION: ' 0.1.42 ' })
    const response = await set.call('/api/app-config')
    expect(await response.json()).toEqual({ minimumVersion: '0.1.42', turnstileSiteKey: null })
    expect(response.headers.get('cache-control')).toContain('max-age')
  })

  it('ignores a value that is not a version, so a typo cannot lock anyone out', async () => {
    const response = await setup({ MIN_APP_VERSION: 'soon' }).call('/api/app-config')
    expect(await response.json()).toEqual({ minimumVersion: null, turnstileSiteKey: null })
  })
})

describe('data requests', () => {
  type Req = {
    kind: string
    status: string
    receivedAt: string
    dueAt: string
    completedAt: string | null
  }
  const list = async (s: ReturnType<typeof setup>, cookie: string): Promise<Req[]> =>
    (await (await s.call('/api/account/requests', { headers: { cookie } })).json()) as Req[]
  const ask = (cookie: string, email: string): RequestInit => ({
    method: 'DELETE',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify({ confirmEmail: email })
  })

  it('logs an export as answered at once, with a 30-day deadline', async () => {
    const s = setup()
    expect((await s.call('/api/account/requests')).status).toBe(401)
    const cookie = await signIn(s, 'log1@example.com')
    await s.call('/api/account/export', { headers: { cookie } })
    const [entry] = await list(s, cookie)
    expect(entry).toMatchObject({ kind: 'export', status: 'done' })
    expect(entry!.completedAt).not.toBeNull()
    const days = (Date.parse(entry!.dueAt) - Date.parse(entry!.receivedAt)) / 86_400_000
    expect(days).toBe(30)
  })

  it('follows a deletion from processing to cancelled', async () => {
    const s = setup()
    const cookie = await signIn(s, 'log2@example.com')
    await s.call('/api/account', ask(cookie, 'log2@example.com'))
    await s.call('/api/account', ask(cookie, 'log2@example.com'))
    expect(await list(s, cookie)).toMatchObject([{ kind: 'deletion', status: 'processing' }])
    await s.call('/api/account/deletion/cancel', { method: 'POST', headers: { cookie } })
    expect(await list(s, cookie)).toMatchObject([{ kind: 'deletion', status: 'cancelled' }])
  })

  it('keeps a done entry without the person after the account is deleted, and tells them', async () => {
    const s = setup()
    const cookie = await signIn(s, 'log3@example.com')
    const me = (await (await s.call('/api/account', { headers: { cookie } })).json()) as {
      id: string
    }
    await s.call('/api/account', ask(cookie, 'log3@example.com'))
    const told: string[] = []
    const db = createDb(bindings.DB)
    await deleteDueAccounts(db, Date.now() + 15 * 86_400_000, 50, async (to) => void told.push(to))
    expect(told).toContain('log3@example.com')
    const row = await bindings.DB.prepare(
      'SELECT kind, status, completed_at FROM data_request WHERE subject_id = ?'
    )
      .bind(me.id)
      .first<{ kind: string; status: string; completed_at: number | null }>()
    expect(row).toMatchObject({ kind: 'deletion', status: 'done' })
    expect(row!.completed_at).not.toBeNull()
    // Nothing in the log can name the person: no email column exists.
    const columns = await bindings.DB.prepare(
      "SELECT name FROM pragma_table_info('data_request')"
    ).all<{ name: string }>()
    expect(columns.results.map((c) => c.name)).not.toContain('email')
  })
})

describe('feature flags', () => {
  const put = (key: string, killed: number, channels: string, percent: number): Promise<unknown> =>
    bindings.DB.prepare(
      'INSERT OR REPLACE INTO feature_flag (key, description, killed, channels, percent, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(key, '', killed, channels, percent, Date.now())
      .run()
  const get = async (path: string): Promise<Record<string, boolean>> =>
    ((await (await setup().call(path)).json()) as { flags: Record<string, boolean> }).flags

  it('is public, answers for the channel, and has nothing when there are no flags', async () => {
    await bindings.DB.prepare('DELETE FROM feature_flag').run()
    expect(await get('/api/flags')).toEqual({})
    await put('everyone', 0, '', 100)
    await put('beta-only', 0, 'beta', 100)
    await put('off', 0, '', 0)
    expect(await get('/api/flags?channel=stable')).toEqual({
      everyone: true,
      'beta-only': false,
      off: false
    })
    expect(await get('/api/flags?channel=beta')).toEqual({
      everyone: true,
      'beta-only': true,
      off: false
    })
  })

  it('the kill switch turns a flag off for everyone at once', async () => {
    await put('risky', 0, '', 100)
    expect((await get('/api/flags'))['risky']).toBe(true)
    await put('risky', 1, '', 100)
    expect((await get('/api/flags'))['risky']).toBe(false)
  })

  it('gives an install the same answer, and only adds installs as the percentage rises', async () => {
    const ids = Array.from({ length: 60 }, (_, i) => `install-${i}-abcdefgh`)
    const on = async (percent: number): Promise<string[]> => {
      await put('gradual', 0, '', percent)
      const answers = await Promise.all(ids.map((id) => get(`/api/flags?id=${id}`)))
      return ids.filter((_, i) => answers[i]!['gradual'])
    }
    const ten = await on(10)
    const fifty = await on(50)
    expect(await on(50)).toEqual(fifty)
    for (const id of ten) expect(fifty).toContain(id)
    expect(fifty.length).toBeGreaterThan(ten.length)
    // Without an install id only 0% and 100% can be decided.
    await put('gradual', 0, '', 50)
    expect((await get('/api/flags'))['gradual']).toBe(false)
  })

  it('rejects an unknown channel and a strange id', async () => {
    const s = setup()
    expect((await s.call('/api/flags?channel=nightly')).status).toBe(400)
    expect((await s.call('/api/flags?id=x')).status).toBe(400)
  })
})

describe('consent ledger', () => {
  const post = (cookie: string, body: unknown): RequestInit => ({
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  type Ledger = {
    current: Record<string, boolean>
    history: { purpose: string; granted: boolean }[]
  }

  it('records agreements and withdrawals as entries and never edits old ones', async () => {
    const s = setup()
    const cookie = await signIn(s, 'consent@example.com')
    const first = (await (
      await s.call('/api/account/consents', { headers: { cookie } })
    ).json()) as Ledger
    expect(first).toEqual({ current: {}, history: [] })

    await s.call('/api/account/consents', post(cookie, { purpose: 'crash-reports', granted: true }))
    // Repeating the same answer adds nothing; withdrawing adds an entry.
    await s.call('/api/account/consents', post(cookie, { purpose: 'crash-reports', granted: true }))
    const res = await s.call(
      '/api/account/consents',
      post(cookie, { purpose: 'crash-reports', granted: false })
    )
    const ledger = (await res.json()) as Ledger
    expect(ledger.current).toEqual({ 'crash-reports': false })
    expect(ledger.history.map((e) => e.granted)).toEqual([false, true])
  })

  it('ignores a withdrawal of something never agreed to, rejects odd purposes, and needs sign-in', async () => {
    const s = setup()
    const cookie = await signIn(s, 'consent2@example.com')
    const res = await s.call(
      '/api/account/consents',
      post(cookie, { purpose: 'product-emails', granted: false })
    )
    expect(((await res.json()) as Ledger).history).toEqual([])
    expect(
      (await s.call('/api/account/consents', post(cookie, { purpose: 'ads', granted: true })))
        .status
    ).toBe(400)
    expect((await s.call('/api/account/consents')).status).toBe(401)
  })

  it('is part of the export', async () => {
    const s = setup()
    const cookie = await signIn(s, 'consent3@example.com')
    await s.call(
      '/api/account/consents',
      post(cookie, { purpose: 'product-emails', granted: true })
    )
    const out = (await (await s.call('/api/account/export', { headers: { cookie } })).json()) as {
      consents: { purpose: string }[]
    }
    expect(out.consents).toHaveLength(1)
  })
})

describe('security activity (audit trail)', () => {
  type Entry = { type: string; outcome: string; label: string | null }
  const activity = async (s: ReturnType<typeof setup>, cookie: string): Promise<Entry[]> =>
    (await s.call('/api/account/security-activity', { headers: { cookie } })).json()

  it('records a sign-in and lists it for the person only', async () => {
    const s = setup()
    const cookie = await signIn(s, 'audit@example.com', 'Mozilla/5.0 (Windows NT 10.0) Chrome/120')
    const mine = await activity(s, cookie)
    expect(mine.map((e) => e.type)).toContain('user_signed_in')
    const other = await signIn(s, 'other-audit@example.com')
    expect((await activity(s, other)).length).toBe(1)
  })

  it('records a bad magic link as a failed sign-in with no person attached', async () => {
    const s = setup()
    const cookie = await signIn(s, 'audit2@example.com')
    const bad = await s.call('/api/auth/magic-link/verify?token=nope&callbackURL=/app')
    expect(bad.headers.get('location') ?? '').toMatch(/error/i)
    // Anonymous events are not shown to anyone's account page.
    expect((await activity(s, cookie)).every((e) => e.outcome === 'success')).toBe(true)
  })

  it('records revoking all sessions and counts events in the privacy summary and export', async () => {
    const s = setup()
    const cookie = await signIn(s, 'audit3@example.com')
    const revoke = await s.call('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: '{}'
    })
    expect(revoke.status).toBe(200)
    const types = (await activity(s, cookie)).map((e) => e.type)
    expect(types).toContain('all_sessions_revoked')
    const privacy = (await (
      await s.call('/api/account/privacy', { headers: { cookie } })
    ).json()) as { securityEvents: number }
    expect(privacy.securityEvents).toBeGreaterThanOrEqual(2)
    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as { securityActivity: Entry[] }
    expect(exported.securityActivity.length).toBeGreaterThanOrEqual(2)
  })
})

describe('staff roles (admin plugin)', () => {
  const json = { 'content-type': 'application/json' }
  /** Makes the account, gives it the role, then signs in again so the new session carries the role. */
  async function staff(s: ReturnType<typeof setup>, email: string, role: string): Promise<string> {
    await signIn(s, email)
    await bindings.DB.prepare('UPDATE user SET role = ? WHERE email = ?').bind(role, email).run()
    return signIn(s, email)
  }
  const list = (s: ReturnType<typeof setup>, cookie: string): Promise<Response> =>
    s.call('/api/auth/admin/list-users?limit=5', { headers: { cookie } })

  it('lets an admin list people, and nobody else', async () => {
    const s = setup()
    const admin = await staff(s, 'boss@example.com', 'admin')
    expect((await list(s, admin)).status).toBe(200)
    const plain = await signIn(s, 'plain@example.com')
    expect((await list(s, plain)).status).toBe(403)
    expect((await list(s, '')).status).toBeGreaterThanOrEqual(401)
  })

  it('gives support a read-only view', async () => {
    const s = setup()
    const support = await staff(s, 'help@example.com', 'support')
    expect((await list(s, support)).status).toBe(200)
    const ban = await s.call('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { cookie: support, ...json },
      body: JSON.stringify({ userId: 'whoever' })
    })
    expect(ban.status).toBe(403)
  })

  it('bans a person: their sessions end, they cannot sign in again, and it is in the trail', async () => {
    const s = setup()
    const admin = await staff(s, 'boss2@example.com', 'admin')
    const victim = await signIn(s, 'victim@example.com')
    const row = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('victim@example.com')
      .first<{ id: string }>()
    const ban = await s.call('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({ userId: row!.id, banReason: 'abuse' })
    })
    expect(ban.status).toBe(200)
    const events = await bindings.DB.prepare(
      "SELECT actor_id FROM audit_event WHERE user_id = ? AND type = 'user_banned'"
    )
      .bind(row!.id)
      .all()
    expect(events.results).toHaveLength(1)
    expect(events.results[0]!.actor_id).not.toBeNull()
    // A new link no longer signs them in.
    const before = s.sent.length
    await s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'victim@example.com', callbackURL: '/app' })
    })
    const link = /https?:\/\/\S+magic-link\/verify\S+/.exec(s.sent[before]!.text)![0]
    const verify = await s.call(new URL(link).pathname + new URL(link).search)
    expect(verify.headers.getSetCookie().join(';')).not.toContain('session_token')
    expect(verify.status).toBe(302)
    expect(verify.headers.get('location')).toContain('/sign-in?error=suspended')
    void victim
  })

  it('lets staff look as a person but not act as them, and still lets them stop', async () => {
    const s = setup()
    const admin = await staff(s, 'boss3@example.com', 'admin')
    await signIn(s, 'viewed@example.com')
    const row = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('viewed@example.com')
      .first<{ id: string }>()
    const imp = await s.call('/api/auth/admin/impersonate-user', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({ userId: row!.id })
    })
    expect(imp.status).toBe(200)
    // Later cookies with the same name win, as in a browser.
    const jar = new Map<string, string>()
    for (const part of [admin, ...imp.headers.getSetCookie().map((c) => c.split(';')[0]!)])
      for (const pair of part.split('; ')) jar.set(pair.split('=')[0]!, pair)
    const cookie = [...jar.values()].join('; ')
    const post = (path: string, body: unknown): Promise<Response> =>
      s.call(path, { method: 'POST', headers: { cookie, ...json }, body: JSON.stringify(body) })

    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(200)
    expect((await post('/api/auth/api-key/create', { name: 'backdoor' })).status).toBe(403)
    expect(
      (await post('/api/account/email-change', { newEmail: 'staff@example.com' })).status
    ).toBe(403)
    expect((await s.call('/api/account/export', { headers: { cookie } })).status).toBe(403)
    expect((await post('/api/auth/admin/stop-impersonating', {})).status).toBe(200)
  })
})

describe('API keys', () => {
  const json = { 'content-type': 'application/json' }
  const make = (s: ReturnType<typeof setup>, cookie: string, name = 'script'): Promise<Response> =>
    s.call('/api/auth/api-key/create', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ name })
    })

  it('makes a key that works once in the header, and stops working when deleted', async () => {
    const s = setup()
    const cookie = await signIn(s, 'keys@example.com')
    const created = await make(s, cookie)
    expect(created.status).toBe(200)
    const body = (await created.json()) as { key: string; id: string; expiresAt: string | null }
    expect(body.key).toMatch(/^key_/)
    expect(body.expiresAt).not.toBeNull()

    const me = await s.call('/api/v1/me', { headers: { 'x-api-key': body.key } })
    expect(me.status).toBe(200)
    expect(await me.json()).toMatchObject({ email: 'keys@example.com' })
    expect((await s.call('/api/v1/me', { headers: { 'x-api-key': 'key_nope' } })).status).toBe(401)
    expect((await s.call('/api/v1/me')).status).toBe(401)

    // The database holds a hash, never the key.
    const stored = await bindings.DB.prepare('SELECT key FROM apikey WHERE id = ?')
      .bind(body.id)
      .first<{ key: string }>()
    expect(stored!.key).not.toBe(body.key)

    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as { apiKeys: { name: string }[] }
    expect(exported.apiKeys).toHaveLength(1)
    expect(JSON.stringify(exported)).not.toContain(body.key)

    await s.call('/api/auth/api-key/delete', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ keyId: body.id })
    })
    expect((await s.call('/api/v1/me', { headers: { 'x-api-key': body.key } })).status).toBe(401)
  })

  it('needs a name, a session, and stops at ten keys', async () => {
    const s = setup()
    expect((await make(s, '')).status).toBeGreaterThanOrEqual(401)
    const cookie = await signIn(s, 'many@example.com')
    expect((await make(s, cookie, '')).status).toBe(400)
    for (let i = 0; i < 10; i++) expect((await make(s, cookie, `k${i}`)).status).toBe(200)
    expect((await make(s, cookie, 'eleventh')).status).toBe(400)
  })

  it('does not accept a key from a suspended person', async () => {
    const s = setup()
    const cookie = await signIn(s, 'gone@example.com')
    const { key } = (await (await make(s, cookie)).json()) as { key: string }
    await bindings.DB.prepare('UPDATE user SET banned = 1 WHERE email = ?')
      .bind('gone@example.com')
      .run()
    expect((await s.call('/api/v1/me', { headers: { 'x-api-key': key } })).status).toBe(401)
  })
})

describe('teams (organization plugin)', () => {
  const json = { 'content-type': 'application/json' }
  const post = (
    s: ReturnType<typeof setup>,
    cookie: string,
    path: string,
    body: unknown
  ): Promise<Response> =>
    s.call(`/api/auth/organization/${path}`, {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify(body)
    })

  it('creates a team, invites by email, and the invited person joins', async () => {
    const s = setup()
    const owner = await signIn(s, 'owner@example.com')
    const made = await post(s, owner, 'create', { name: 'Acme', slug: 'acme-1' })
    expect(made.status).toBe(200)
    const team = (await made.json()) as { id: string }

    const before = s.sent.length
    const invited = await post(s, owner, 'invite-member', {
      email: 'guest@example.com',
      role: 'member',
      organizationId: team.id
    })
    expect(invited.status).toBe(200)
    const mail = s.sent[before]!
    expect(mail.to).toBe('guest@example.com')
    const id = /accept-invitation\/([\w-]+)/.exec(mail.text)![1]!

    // Someone else cannot use the invitation.
    const stranger = await signIn(s, 'stranger@example.com')
    expect((await post(s, stranger, 'accept-invitation', { invitationId: id })).status).toBe(403)

    const guest = await signIn(s, 'guest@example.com')
    expect((await post(s, guest, 'accept-invitation', { invitationId: id })).status).toBe(200)
    const members = await bindings.DB.prepare('SELECT role FROM member WHERE organization_id = ?')
      .bind(team.id)
      .all<{ role: string }>()
    expect(members.results.map((m) => m.role).sort()).toEqual(['member', 'owner'])

    // A plain member cannot invite.
    const denied = await post(s, guest, 'invite-member', {
      email: 'third@example.com',
      role: 'member',
      organizationId: team.id
    })
    expect(denied.status).toBe(403)
  })

  it('limits how many teams one person can start', async () => {
    const s = setup()
    const cookie = await signIn(s, 'busy@example.com')
    for (let i = 0; i < 5; i++) {
      const made = await post(s, cookie, 'create', { name: `T${i}`, slug: `busy-${i}` })
      expect(made.status).toBe(200)
    }
    expect((await post(s, cookie, 'create', { name: 'Six', slug: 'busy-6' })).status).toBe(403)
  })

  it('lists teams in the export, and removes only teams nobody else is in when an account goes', async () => {
    const s = setup()
    const cookie = await signIn(s, 'solo@example.com')
    const solo = (await (
      await post(s, cookie, 'create', { name: 'Solo', slug: 'solo-1' })
    ).json()) as { id: string }
    const shared = (await (
      await post(s, cookie, 'create', { name: 'Shared', slug: 'solo-2' })
    ).json()) as { id: string }
    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as { teams: { name: string }[] }
    expect(exported.teams.map((t) => t.name).sort()).toEqual(['Shared', 'Solo'])

    await signIn(s, 'mate@example.com')
    await bindings.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) SELECT 'm-x', ?, id, 'member', 1 FROM user WHERE email = 'mate@example.com'"
    )
      .bind(shared.id)
      .run()
    const me = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('solo@example.com')
      .first<{ id: string }>()
    await soloTeamsDeletion(createDb(bindings.DB), me!.id)
    const exists = (id: string): Promise<unknown> =>
      bindings.DB.prepare('SELECT id FROM organization WHERE id = ?').bind(id).first()
    expect(await exists(solo.id)).toBeNull()
    expect(await exists(shared.id)).not.toBeNull()
  })
})

describe('workspace', () => {
  const json = { 'content-type': 'application/json' }
  const org = (s: ReturnType<typeof setup>, cookie: string, path: string, body: unknown) =>
    s.call(`/api/auth/organization/${path}`, {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify(body)
    })
  const current = async (s: ReturnType<typeof setup>, cookie: string) =>
    (await (await s.call('/api/workspace', { headers: { cookie } })).json()) as {
      teamId: string | null
      teamName: string | null
      role: string
    }

  it('needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/workspace')).status).toBe(401)
  })

  it('is Personal until a team is active, then names the team and the role', async () => {
    const s = setup()
    const cookie = await signIn(s, 'ws-owner@example.com')
    expect(await current(s, cookie)).toEqual({ teamId: null, teamName: null, role: '' })
    const made = await org(s, cookie, 'create', { name: 'Acme', slug: 'acme-ws' })
    const team = (await made.json()) as { id: string }
    expect(await current(s, cookie)).toEqual({ teamId: team.id, teamName: 'Acme', role: 'owner' })
  })

  it('ignores an active team the person is no longer a member of', async () => {
    const s = setup()
    const owner = await signIn(s, 'ws-own2@example.com')
    const team = (await (
      await org(s, owner, 'create', { name: 'Gone', slug: 'gone-ws' })
    ).json()) as {
      id: string
    }
    const outsider = await signIn(s, 'ws-out@example.com')
    // A removed member's session still points at the team: nothing clears it.
    await bindings.DB.prepare(
      "UPDATE session SET active_organization_id = ? WHERE user_id = (SELECT id FROM user WHERE email = 'ws-out@example.com')"
    )
      .bind(team.id)
      .run()
    expect(await current(s, outsider)).toEqual({ teamId: null, teamName: null, role: '' })
  })
})

describe('workspace to-do list', () => {
  const json = { 'content-type': 'application/json' }
  const org = (s: ReturnType<typeof setup>, cookie: string, path: string, body: unknown) =>
    s.call(`/api/auth/organization/${path}`, {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify(body)
    })
  const add = (s: ReturnType<typeof setup>, cookie: string, title: string) =>
    s.call('/api/todos', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ title })
    })
  const list = async (s: ReturnType<typeof setup>, cookie: string) =>
    (await (await s.call('/api/todos', { headers: { cookie } })).json()) as {
      workspace: { teamId: string | null }
      todos: { id: string; title: string; done: boolean; mine: boolean; canRemove: boolean }[]
    }
  const setWorkspace = (email: string, teamId: string | null) =>
    bindings.DB.prepare(
      'UPDATE session SET active_organization_id = ? WHERE user_id = (SELECT id FROM user WHERE email = ?)'
    )
      .bind(teamId, email)
      .run()

  it('needs a session', async () => {
    const s = setup()
    expect((await s.call('/api/todos')).status).toBe(401)
  })

  it('keeps Personal items private and team items inside the team', async () => {
    const s = setup()
    const owner = await signIn(s, 'todo-owner@example.com')
    expect((await add(s, owner, 'my own thing')).status).toBe(201)
    const team = (await (
      await org(s, owner, 'create', { name: 'Acme', slug: 'acme-todo' })
    ).json()) as {
      id: string
    }
    // Creating a team makes it the active workspace, so the Personal item is not in the list.
    expect((await list(s, owner)).workspace.teamId).toBe(team.id)
    expect((await list(s, owner)).todos).toHaveLength(0)
    await add(s, owner, 'for the team')

    const before = s.sent.length
    await org(s, owner, 'invite-member', {
      email: 'todo-mate@example.com',
      role: 'member',
      organizationId: team.id
    })
    const id = /accept-invitation\/([\w-]+)/.exec(s.sent[before]!.text)![1]!
    const mate = await signIn(s, 'todo-mate@example.com')
    await org(s, mate, 'accept-invitation', { invitationId: id })
    await setWorkspace('todo-mate@example.com', team.id)
    const seen = await list(s, mate)
    expect(seen.todos.map((t) => t.title)).toEqual(['for the team'])
    expect(seen.todos[0]).toMatchObject({ mine: false, canRemove: false })

    // Any member can tick an item, but only its author or a team admin can remove it.
    const tick = await s.call(`/api/todos/${seen.todos[0]!.id}`, {
      method: 'PATCH',
      headers: { cookie: mate, ...json },
      body: JSON.stringify({ done: true })
    })
    expect(tick.status).toBe(204)
    expect((await list(s, owner)).todos[0]!.done).toBe(true)
    const denied = await s.call(`/api/todos/${seen.todos[0]!.id}`, {
      method: 'DELETE',
      headers: { cookie: mate }
    })
    expect(denied.status).toBe(403)

    // Back in Personal the mate sees nothing of the team's list.
    await setWorkspace('todo-mate@example.com', null)
    expect((await list(s, mate)).todos).toHaveLength(0)

    // The owner can remove a member's item.
    await setWorkspace('todo-mate@example.com', team.id)
    await add(s, mate, 'from the mate')
    const theirs = (await list(s, owner)).todos.find((t) => t.title === 'from the mate')!
    expect(theirs.canRemove).toBe(true)
    const removed = await s.call(`/api/todos/${theirs.id}`, {
      method: 'DELETE',
      headers: { cookie: owner }
    })
    expect(removed.status).toBe(204)
  })

  it('shows a person who left the team nothing of it, and cannot touch its items', async () => {
    const s = setup()
    const owner = await signIn(s, 'todo-own2@example.com')
    const team = (await (
      await org(s, owner, 'create', { name: 'Gone', slug: 'gone-todo' })
    ).json()) as {
      id: string
    }
    await add(s, owner, 'team secret')
    const item = (await list(s, owner)).todos[0]!
    const outsider = await signIn(s, 'todo-out@example.com')
    // A removed member's session still points at the team: nothing clears it.
    await setWorkspace('todo-out@example.com', team.id)
    const view = await list(s, outsider)
    expect(view.workspace.teamId).toBeNull()
    expect(view.todos).toHaveLength(0)
    const tick = await s.call(`/api/todos/${item.id}`, {
      method: 'PATCH',
      headers: { cookie: outsider, ...json },
      body: JSON.stringify({ done: true })
    })
    expect(tick.status).toBe(404)
    expect(
      (await s.call(`/api/todos/${item.id}`, { method: 'DELETE', headers: { cookie: outsider } }))
        .status
    ).toBe(404)
  })

  it('validates the title, and is part of the data export', async () => {
    const s = setup()
    const cookie = await signIn(s, 'todo-exp@example.com')
    expect((await add(s, cookie, '   ')).status).toBe(400)
    expect((await add(s, cookie, 'x'.repeat(201))).status).toBe(400)
    await add(s, cookie, 'water the plants')
    const data = (await (await s.call('/api/account/export', { headers: { cookie } })).json()) as {
      todos: { team: string | null; title: string; done: boolean }[]
    }
    expect(data.todos).toEqual([
      expect.objectContaining({ team: null, title: 'water the plants', done: false })
    ])
  })

  it('removes a team items with the team', async () => {
    const s = setup()
    const owner = await signIn(s, 'todo-own3@example.com')
    const team = (await (
      await org(s, owner, 'create', { name: 'Temp', slug: 'temp-todo' })
    ).json()) as {
      id: string
    }
    await add(s, owner, 'short lived')
    await org(s, owner, 'delete', { organizationId: team.id })
    const left = await bindings.DB.prepare(
      'SELECT COUNT(*) AS n FROM todo WHERE organization_id = ?'
    )
      .bind(team.id)
      .first<{ n: number }>()
    expect(left?.n).toBe(0)
  })
})

describe('single sign-on (OpenID Connect)', () => {
  const json = { 'content-type': 'application/json' }
  const provider = (providerId: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({
      providerId,
      issuer: 'https://idp.example.com',
      domain: 'acme.example',
      oidcConfig: {
        clientId: 'client',
        clientSecret: 'secret',
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        jwksEndpoint: 'https://idp.example.com/jwks',
        discoveryEndpoint: 'https://idp.example.com/.well-known/openid-configuration',
        skipDiscovery: true,
        scopes: ['openid', 'email', 'profile']
      },
      ...extra
    })
  const register = (s: ReturnType<typeof setup>, cookie: string, body: string): Promise<Response> =>
    s.call('/api/auth/sso/register', { method: 'POST', headers: { cookie, ...json }, body })

  it('lets only an admin register a provider', async () => {
    const s = setup()
    const plain = await signIn(s, 'plain-sso@example.com')
    expect((await register(s, plain, provider('acme'))).status).toBe(403)

    await signIn(s, 'boss-sso@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('boss-sso@example.com')
      .run()
    const admin = await signIn(s, 'boss-sso@example.com')
    const made = await register(s, admin, provider('acme'))
    expect(made.status).toBe(200)
    expect(await made.json()).toMatchObject({ providerId: 'acme', domainVerified: false })
  })

  const adminFor = async (s: ReturnType<typeof setup>, email: string): Promise<string> => {
    await signIn(s, email)
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?").bind(email).run()
    return signIn(s, email)
  }
  const update = (
    s: ReturnType<typeof setup>,
    cookie: string,
    providerId: string,
    body: Record<string, unknown>
  ): Promise<Response> =>
    s.call('/api/auth/sso/update-provider', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ providerId, ...body })
    })

  it('freezes who a provider is and its domain while people sign in through it, but lets the secret change', async () => {
    const s = setup()
    const admin = await adminFor(s, 'boss-update@example.com')
    await register(s, admin, provider('upd-co'))

    // Nobody linked yet: everything may change.
    expect((await update(s, admin, 'upd-co', { domain: 'moved.example' })).status).toBe(200)
    expect((await update(s, admin, 'upd-co', { domain: 'acme.example' })).status).toBe(200)

    // Someone signs in through it (a linked account).
    const person = await signIn(s, 'linked-person@example.com')
    expect(person).toBeTruthy()
    await bindings.DB.prepare(
      "INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) SELECT ?, 'sub-1', 'upd-co', id, 0, 0 FROM user WHERE email = ?"
    )
      .bind(crypto.randomUUID(), 'linked-person@example.com')
      .run()

    // The plugin refuses to move the issuer, client id and endpoints ...
    expect((await update(s, admin, 'upd-co', { issuer: 'https://evil.example' })).status).toBe(409)
    expect((await update(s, admin, 'upd-co', { oidcConfig: { clientId: 'another' } })).status).toBe(
      409
    )
    // ... and we refuse the domain; both mean delete and add again.
    const moved = await update(s, admin, 'upd-co', { domain: 'moved.example' })
    expect(moved.status).toBe(409)
    expect(await moved.text()).toContain('Delete it and add it again')
    // Writing the same domain again, rotating the secret and changing scopes are fine.
    expect((await update(s, admin, 'upd-co', { domain: 'ACME.example' })).status).toBe(200)
    expect(
      (
        await update(s, admin, 'upd-co', {
          oidcConfig: { clientSecret: 'rotated', scopes: ['openid', 'email'] }
        })
      ).status
    ).toBe(200)
    // The new secret is stored encrypted like the first one.
    const stored = await bindings.DB.prepare(
      'SELECT oidc_config FROM sso_provider WHERE provider_id = ?'
    )
      .bind('upd-co')
      .first<{ oidc_config: string }>()
    expect(stored!.oidc_config).toContain('enc:v1:')
    expect(stored!.oidc_config).not.toContain('rotated')
    await bindings.DB.prepare('DELETE FROM account WHERE provider_id = ?').bind('upd-co').run()
  })

  it('does not let a provider overwrite the details of people who sign in with it', async () => {
    const s = setup()
    const admin = await adminFor(s, 'boss-override@example.com')
    const body = JSON.parse(provider('override-co')) as { oidcConfig: Record<string, unknown> }
    body.oidcConfig.overrideUserInfo = true
    expect((await register(s, admin, JSON.stringify(body))).status).toBe(400)
    await register(s, admin, provider('override-ok'))
    expect(
      (await update(s, admin, 'override-ok', { oidcConfig: { overrideUserInfo: true } })).status
    ).toBe(400)
  })

  it('refuses endpoints on a private or internal host without any trusted-origins setting', async () => {
    const s = setup()
    const admin = await adminFor(s, 'boss-private@example.com')
    for (const host of ['https://10.0.0.5', 'https://localhost', 'http://idp.example.com']) {
      const body = JSON.parse(provider('private-co')) as { oidcConfig: Record<string, unknown> }
      body.oidcConfig.tokenEndpoint = `${host}/token`
      body.oidcConfig.authorizationEndpoint = `${host}/authorize`
      expect((await register(s, admin, JSON.stringify(body))).status).toBe(400)
    }
  })

  it('serves a team company-sign-in page only for a team with a proven provider', async () => {
    const s = setup()
    const owner = await signIn(s, 'team-page-owner@example.com')
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: 'Page Corp', slug: 'page-corp' })
    })
    const team = (await made.json()) as { id: string }
    // No provider yet: indistinguishable from a team that does not exist.
    expect((await s.call('/api/team-sign-in/page-corp')).status).toBe(404)
    expect((await s.call('/api/team-sign-in/no-such-team')).status).toBe(404)
    expect((await s.call('/api/team-sign-in/Bad%20Slug!')).status).toBe(404)
    await register(s, owner, provider('page-co', { organizationId: team.id }))
    // A provider whose domain is still unproven does not count.
    expect((await s.call('/api/team-sign-in/page-corp')).status).toBe(404)
    await bindings.DB.prepare('UPDATE sso_provider SET domain_verified = 1 WHERE provider_id = ?')
      .bind('page-co')
      .run()
    const page = await s.call('/api/team-sign-in/page-corp')
    expect(page.status).toBe(200)
    expect(await page.json()).toEqual({ name: 'Page Corp' })
  })

  it('lets a team owner add a provider for the team, but not a plain member or a stranger', async () => {
    const s = setup()
    const owner = await signIn(s, 'team-owner-sso@example.com')
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: 'Co', slug: 'co-sso-1' })
    })
    const team = (await made.json()) as { id: string }
    // Without a team it is refused; with the team it works.
    expect((await register(s, owner, provider('team-co-a'))).status).toBe(403)
    const ok = await register(s, owner, provider('team-co-b', { organizationId: team.id }))
    expect(ok.status).toBe(200)
    // Someone who is not in the team cannot attach a provider to it.
    const stranger = await signIn(s, 'team-stranger-sso@example.com')
    const refused = await register(s, stranger, provider('team-co-c', { organizationId: team.id }))
    expect(refused.status).toBeGreaterThanOrEqual(400)
  })

  it('ends the sessions of people who signed in through a provider when it is deleted', async () => {
    const s = setup()
    const owner = await signIn(s, 'team-owner-del@example.com')
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: 'Co2', slug: 'co-sso-2' })
    })
    const team = (await made.json()) as { id: string }
    expect(
      (await register(s, owner, provider('team-co-del', { organizationId: team.id }))).status
    ).toBe(200)
    const victim = await signIn(s, 'person-del@acme.example')
    await bindings.DB.prepare(
      "INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) SELECT 'acc-del', 'sub-1', 'team-co-del', id, 1, 1 FROM user WHERE email = ?"
    )
      .bind('person-del@acme.example')
      .run()
    expect((await s.call('/api/preferences', { headers: { cookie: victim } })).status).toBe(200)
    const gone = await s.call('/api/auth/sso/delete-provider', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ providerId: 'team-co-del' })
    })
    expect(gone.status).toBe(200)
    expect((await s.call('/api/preferences', { headers: { cookie: victim } })).status).toBe(401)
  })

  it('removes a team’s providers when the team is deleted', async () => {
    const s = setup()
    const owner = await signIn(s, 'team-owner-gone@example.com')
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: 'Co3', slug: 'co-sso-3' })
    })
    const team = (await made.json()) as { id: string }
    expect(
      (await register(s, owner, provider('team-co-gone', { organizationId: team.id }))).status
    ).toBe(200)
    await s.call('/api/auth/organization/delete', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ organizationId: team.id })
    })
    const left = await bindings.DB.prepare('SELECT id FROM sso_provider WHERE provider_id = ?')
      .bind('team-co-gone')
      .first()
    expect(left).toBeNull()
  })

  it('looks up sign-in settings only for staff and team owners or admins', async () => {
    const s = setup()
    const plain = await signIn(s, 'plain-disc@example.com')
    expect(
      (
        await s.call('/api/sso-discover?issuer=https://acme.okta.example', {
          headers: { cookie: plain }
        })
      ).status
    ).toBe(403)
    const owner = await signIn(s, 'owner-disc@example.com')
    await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: 'Disc', slug: 'disc-sso-1' })
    })
    // Allowed, but a private address is refused before anything is fetched.
    const refused = await s.call('/api/sso-discover?issuer=https://127.0.0.1', {
      headers: { cookie: owner }
    })
    expect(refused.status).toBe(400)
    expect((await s.call('/api/sso-discover?issuer=https://acme.okta.example')).status).toBe(401)
  })

  it('refuses SAML providers, even from an admin', async () => {
    const s = setup()
    await signIn(s, 'boss-saml@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('boss-saml@example.com')
      .run()
    const admin = await signIn(s, 'boss-saml@example.com')
    const saml = await register(
      s,
      admin,
      JSON.stringify({
        providerId: 'saml-co',
        issuer: 'https://idp.example.com',
        domain: 'saml.example',
        samlConfig: { entryPoint: 'https://idp.example.com/sso', cert: 'x', callbackUrl: '/x' }
      })
    )
    expect(saml.status).toBe(400)
  })

  it('does not sign anyone in through a domain that has not been proven', async () => {
    const s = setup()
    await signIn(s, 'boss-dom@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('boss-dom@example.com')
      .run()
    const admin = await signIn(s, 'boss-dom@example.com')
    await register(s, admin, provider('unproven'))
    const start = await s.call('/api/auth/sign-in/sso', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ providerId: 'unproven', callbackURL: '/app' })
    })
    expect(start.status).toBe(401)
    expect(await start.text()).toContain('has not been verified')
  })
})

describe('closed gaps', () => {
  const json = { 'content-type': 'application/json' }

  it('refuses a key that was not given the permission a route needs', async () => {
    const s = setup()
    const cookie = await signIn(s, 'scope@example.com')
    const made = await s.call('/api/auth/api-key/create', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ name: 'narrow' })
    })
    const { key, id } = (await made.json()) as { key: string; id: string }
    expect((await s.call('/api/v1/me', { headers: { 'x-api-key': key } })).status).toBe(200)
    await bindings.DB.prepare('UPDATE apikey SET permissions = ? WHERE id = ?')
      .bind(JSON.stringify({ other: ['read'] }), id)
      .run()
    expect((await s.call('/api/v1/me', { headers: { 'x-api-key': key } })).status).toBe(401)
  })

  it('lets staff, and only staff, read one person security activity', async () => {
    const s = setup()
    const target = await signIn(s, 'watched@example.com')
    void target
    const row = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('watched@example.com')
      .first<{ id: string }>()
    const url = `/api/admin/audit/${row!.id}`

    await signIn(s, 'staff-a@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'support' WHERE email = ?")
      .bind('staff-a@example.com')
      .run()
    const support = await signIn(s, 'staff-a@example.com')
    const ok = await s.call(url, { headers: { cookie: support } })
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { type: string }[]).map((e) => e.type)).toContain('user_signed_in')

    const plain = await signIn(s, 'plain-b@example.com')
    expect((await s.call(url, { headers: { cookie: plain } })).status).toBe(403)
    expect((await s.call(url)).status).toBe(401)
  })
})

describe('Turnstile verification (Cloudflare answer faked)', () => {
  const VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
  const keys = {
    TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
    TURNSTILE_SITE_KEY: 'site'
  }
  const link = (s: ReturnType<typeof setup>, token?: string): Promise<Response> =>
    s.call('/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { 'x-captcha-response': token } : {})
      },
      body: JSON.stringify({ email: 'captcha@example.com', callbackURL: '/app' })
    })

  /** Pretends to be Cloudflare: only the dummy token passes. Records what was asked. */
  function fakeCloudflare(): { asked: { secret: string | null; response: string | null }[] } {
    const asked: { secret: string | null; response: string | null }[] = []
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (!url.startsWith(VERIFY)) return real(input, init)
      const raw = input instanceof Request ? await input.text() : String(init?.body ?? '')
      const form = new URLSearchParams(raw)
      let body: Record<string, string> = {}
      if (!raw.includes('=') || raw.trim().startsWith('{')) {
        try {
          body = JSON.parse(raw) as Record<string, string>
        } catch {
          body = {}
        }
      }
      const secret = form.get('secret') ?? body.secret ?? null
      const response = form.get('response') ?? body.response ?? null
      asked.push({ secret, response })
      const success = response === 'XXXX.DUMMY.TOKEN.XXXX'
      return Response.json({ success, 'error-codes': success ? [] : ['invalid-input-response'] })
    })
    return { asked }
  }

  afterEach(() => vi.restoreAllMocks())

  it('sends the email when Cloudflare accepts the token, and asks with our secret', async () => {
    const cloudflare = fakeCloudflare()
    const s = setup(keys)
    const response = await link(s, 'XXXX.DUMMY.TOKEN.XXXX')
    expect(response.status).toBe(200)
    expect(s.sent).toHaveLength(1)
    expect(cloudflare.asked).toEqual([
      { secret: keys.TURNSTILE_SECRET_KEY, response: 'XXXX.DUMMY.TOKEN.XXXX' }
    ])
  })

  it('refuses a token Cloudflare rejects, and a missing one never reaches Cloudflare', async () => {
    const cloudflare = fakeCloudflare()
    const s = setup(keys)
    expect((await link(s, 'a-bot-made-this')).status).toBe(403)
    expect((await link(s)).status).toBe(400)
    expect(s.sent).toHaveLength(0)
    expect(cloudflare.asked).toHaveLength(1)
  })

  it('fails closed when Cloudflare cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url.startsWith(VERIFY)) throw new Error('network down')
      return fetch(input, init)
    })
    const s = setup(keys)
    const response = await link(s, 'XXXX.DUMMY.TOKEN.XXXX')
    expect(response.status).toBeGreaterThanOrEqual(500)
    expect(s.sent).toHaveLength(0)
  })

  it('does not ask for a token on other sign-in routes', async () => {
    fakeCloudflare()
    const s = setup(keys)
    const response = await s.call('/api/auth/magic-link/verify?token=nope&callbackURL=/app')
    expect(response.status).toBe(302)
  })
})

describe('single sign-on, a whole login against a fake identity provider', () => {
  const json = { 'content-type': 'application/json' }
  const IDP = 'https://idp.acme.example'
  const b64 = (data: ArrayBuffer | string): string => {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
    let text = ''
    for (const b of bytes) text += String.fromCharCode(b)
    return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  }

  /** A pretend identity provider: signs id tokens with its own key and publishes the public half. */
  const tokenCalls: (string | null)[] = []
  const tokenBodies: string[] = []
  async function fakeIdp(claims: () => Record<string, unknown>): Promise<void> {
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair
    const jwk = {
      ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
      kid: 'k1',
      alg: 'RS256',
      use: 'sig'
    }
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === `${IDP}/jwks`) return Response.json({ keys: [jwk] })
      if (url === `${IDP}/token`) {
        tokenCalls.push(new Headers(init?.headers).get('authorization'))
        tokenBodies.push(String(init?.body ?? ''))
        const head = b64(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
        const now = Math.floor(Date.now() / 1000)
        const body = b64(
          JSON.stringify({ iss: IDP, aud: 'client', iat: now, exp: now + 300, ...claims() })
        )
        const sig = await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          pair.privateKey,
          new TextEncoder().encode(`${head}.${body}`)
        )
        return Response.json({
          access_token: 'at',
          token_type: 'Bearer',
          id_token: `${head}.${body}.${b64(sig)}`
        })
      }
      if (url.startsWith(IDP)) return new Response('not found', { status: 404 })
      return real(input, init)
    })
  }

  async function setupCompany(
    s: ReturnType<typeof setup>,
    verified: boolean,
    id: string
  ): Promise<void> {
    await signIn(s, 'boss-oidc@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('boss-oidc@example.com')
      .run()
    const admin = await signIn(s, 'boss-oidc@example.com')
    const made = await s.call('/api/auth/sso/register', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({
        providerId: id,
        issuer: IDP,
        domain: `${id}.example`,
        oidcConfig: {
          clientId: 'client',
          clientSecret: 'secret',
          authorizationEndpoint: `${IDP}/authorize`,
          tokenEndpoint: `${IDP}/token`,
          jwksEndpoint: `${IDP}/jwks`,
          discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
          skipDiscovery: true,
          scopes: ['openid', 'email', 'profile']
        }
      })
    })
    expect(made.status).toBe(200)
    if (verified)
      await bindings.DB.prepare('UPDATE sso_provider SET domain_verified = 1 WHERE provider_id = ?')
        .bind(id)
        .run()
  }

  /** Starts a company login and returns the callback request the identity provider would send back. */
  async function startLogin(
    s: ReturnType<typeof setup>,
    id: string
  ): Promise<{ path: string; cookie: string }> {
    const start = await s.call('/api/auth/sign-in/sso', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: `ada@${id}.example`, callbackURL: '/app' })
    })
    expect(start.status).toBe(200)
    const { url } = (await start.json()) as { url: string }
    expect(url.startsWith(`${IDP}/authorize`)).toBe(true)
    const state = new URL(url).searchParams.get('state')!
    const cookie = start.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ')
    return { path: `/api/auth/sso/callback/${id}?code=abc&state=${state}`, cookie }
  }

  afterEach(() => vi.restoreAllMocks())

  /**
   * A company with a team, a proven domain and a directory connection. Returns what the directory needs and a way to
   * push a person into it.
   */
  async function companyWithDirectory(s: ReturnType<typeof setup>, id: string) {
    await setupCompany(s, true, id)
    const ownerEmail = `owner@${id}.example`
    const owner = await signIn(s, ownerEmail)
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: `Team ${id}`, slug: `team-${id}` })
    })
    const team = (await made.json()) as { id: string }
    await bindings.DB.prepare('UPDATE sso_provider SET organization_id = ? WHERE provider_id = ?')
      .bind(team.id, id)
      .run()
    const conn = await s.call('/api/scim-connections', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ organizationId: team.id, name: 'Okta' })
    })
    expect(conn.status).toBe(201)
    const { token } = (await conn.json()) as { token: string }
    const scim = (path: string, method: string, body?: unknown): Promise<Response> =>
      s.call(`/api/scim/v2${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/scim+json' })
        },
        body: body === undefined ? undefined : JSON.stringify(body)
      })
    const push = async (email: string, externalId: string): Promise<string> => {
      const r = await scim('/Users', 'POST', {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: email,
        externalId,
        emails: [{ value: email, primary: true, type: 'work' }]
      })
      expect(r.status).toBe(201)
      return ((await r.json()) as { id: string }).id
    }
    const setActive = async (scimId: string, active: boolean): Promise<void> => {
      const r = await scim(`/Users/${scimId}`, 'PATCH', {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'active', value: active }]
      })
      expect(r.status).toBe(200)
    }
    return { push, setActive }
  }

  const linksOf = async (providerId: string): Promise<number> =>
    (await bindings.DB.prepare('SELECT COUNT(*) AS n FROM account WHERE provider_id = ?')
      .bind(providerId)
      .first<{ n: number }>())!.n

  const loginAs = async (s: ReturnType<typeof setup>, id: string): Promise<Response> => {
    const { path, cookie } = await startLogin(s, id)
    return s.call(path, { headers: { cookie } })
  }

  it('signs in to the company with a private key instead of a shared secret, kept encrypted', async () => {
    await fakeIdp(() => ({ sub: 'pk-sub', email: 'ada@pk-co.example', email_verified: true }))
    const pair = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256'
      },
      true,
      ['sign', 'verify']
    )) as CryptoKeyPair
    const der = new Uint8Array(
      (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer
    )
    let raw = ''
    for (const b of der) raw += String.fromCharCode(b)
    const pem = [
      '-----BEGIN PRIVATE KEY-----',
      ...btoa(raw).match(/.{1,64}/g)!,
      '-----END PRIVATE KEY-----'
    ].join(String.fromCharCode(10))

    const s = setup()
    await signIn(s, 'boss-oidc@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('boss-oidc@example.com')
      .run()
    const admin = await signIn(s, 'boss-oidc@example.com')
    const register = (privateKey: string): Promise<Response> =>
      s.call('/api/auth/sso/register', {
        method: 'POST',
        headers: { cookie: admin, ...json },
        body: JSON.stringify({
          providerId: 'pk-co',
          issuer: IDP,
          domain: 'pk-co.example',
          oidcConfig: {
            clientId: 'client',
            clientSecret: privateKey,
            tokenEndpointAuthentication: 'private_key_jwt',
            privateKeyAlgorithm: 'RS256',
            privateKeyId: 'our-key-1',
            authorizationEndpoint: `${IDP}/authorize`,
            tokenEndpoint: `${IDP}/token`,
            jwksEndpoint: `${IDP}/jwks`,
            discoveryEndpoint: `${IDP}/.well-known/openid-configuration`,
            skipDiscovery: true,
            scopes: ['openid', 'email', 'profile']
          }
        })
      })
    // Not a key: refused before anything is stored.
    expect((await register('not a key')).status).toBe(400)
    expect(await linksOf('pk-co')).toBe(0)
    expect((await register(pem)).status).toBe(200)
    await bindings.DB.prepare('UPDATE sso_provider SET domain_verified = 1 WHERE provider_id = ?')
      .bind('pk-co')
      .run()

    // At rest the key is encrypted, like a client secret.
    const stored = await bindings.DB.prepare(
      "SELECT oidc_config AS c FROM sso_provider WHERE provider_id = 'pk-co'"
    ).first<{ c: string }>()
    expect(stored!.c).not.toContain('BEGIN PRIVATE KEY')
    expect(stored!.c).toContain('enc:v1:')

    tokenBodies.length = 0
    const done = await loginAs(s, 'pk-co')
    expect(done.status).toBe(302)
    expect(tokenBodies.length).toBe(1)
    const sent = new URLSearchParams(tokenBodies[0])
    expect(sent.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
    )
    // A signed statement, never a secret.
    const assertion = sent.get('client_assertion')!
    expect(assertion.split('.')).toHaveLength(3)
    expect(sent.get('client_secret')).toBeNull()
    expect(
      JSON.parse(atob(assertion.split('.')[0]!.replaceAll('-', '+').replaceAll('_', '/')))
    ).toMatchObject({
      alg: 'RS256',
      kid: 'our-key-1'
    })
  })

  it('links company sign-in to a person the directory lists as active, and unlinks them when switched off', async () => {
    await fakeIdp(() => ({
      sub: 'dir-sub-1',
      email: 'ada@dir-co.example',
      email_verified: true,
      name: 'Ada'
    }))
    const s = setup()
    const { push, setActive } = await companyWithDirectory(s, 'dir-co')
    const scimId = await push('ada@dir-co.example', 'dir-sub-1')
    // A directory-made account has an unverified address, and the plugin links only verified ones: as soon as the
    // person has proven it (a magic link), their company sign-in can link.
    await bindings.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?')
      .bind('ada@dir-co.example')
      .run()

    const first = await loginAs(s, 'dir-co')
    expect(first.headers.getSetCookie().join(';')).toContain('session_token')
    expect(await linksOf('dir-co')).toBe(1)

    // Switched off in the directory: the link is removed with the membership ...
    await setActive(scimId, false)
    expect(await linksOf('dir-co')).toBe(0)
    // ... and the identity provider cannot link it again while the person stays off.
    const refused = await loginAs(s, 'dir-co')
    expect(refused.headers.getSetCookie().join(';')).not.toContain('session_token')
    expect(await linksOf('dir-co')).toBe(0)
    const failure = await bindings.DB.prepare(
      "SELECT detail FROM audit_event WHERE type = 'user_sign_in_failed' AND detail LIKE '%SSO_DEPROVISIONED%'"
    ).first()
    expect(failure).not.toBeNull()

    // Switched back on: signing in links again.
    await setActive(scimId, true)
    const again = await loginAs(s, 'dir-co')
    expect(again.headers.getSetCookie().join(';')).toContain('session_token')
    expect(await linksOf('dir-co')).toBe(1)
  })

  it('does not link an identity the directory ties to someone else, even with a matching email', async () => {
    // The identity provider says "sub 'victim-sub', email ada@..." but the directory says victim-sub is another person.
    await fakeIdp(() => ({
      sub: 'victim-sub',
      email: 'ada@tied-co.example',
      email_verified: true
    }))
    const s = setup()
    const { push } = await companyWithDirectory(s, 'tied-co')
    await push('ada@tied-co.example', 'ada-sub')
    await push('victim@tied-co.example', 'victim-sub')
    // Verified, so that only our rule (not the plugin's own verified-address rule) can be what refuses.
    await bindings.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?')
      .bind('ada@tied-co.example')
      .run()

    const response = await loginAs(s, 'tied-co')
    expect(response.headers.getSetCookie().join(';')).not.toContain('session_token')
    expect(await linksOf('tied-co')).toBe(0)
  })

  it('leaves people the directory does not list, alone', async () => {
    await fakeIdp(() => ({ sub: 'free-sub', email: 'ada@free-co.example', email_verified: true }))
    const s = setup()
    const { push } = await companyWithDirectory(s, 'free-co')
    await push('someone-else@free-co.example', 'other-sub')
    const response = await loginAs(s, 'free-co')
    expect(response.headers.getSetCookie().join(';')).toContain('session_token')
    expect(await linksOf('free-co')).toBe(1)
  })

  it('signs a person from the verified company in, creating the account', async () => {
    await fakeIdp(() => ({
      sub: 'idp-1',
      email: 'ada@good-co.example',
      email_verified: true,
      name: 'Ada'
    }))
    const s = setup()
    await setupCompany(s, true, 'good-co')
    const { path, cookie } = await startLogin(s, 'good-co')
    const back = await s.call(path, { headers: { cookie } })
    expect(back.status).toBe(302)
    expect(back.headers.get('location')).toContain('/app')
    expect(back.headers.getSetCookie().join(';')).toContain('session_token')
    // The provider was asked with the real secret, although the database only holds it encrypted.
    expect(tokenCalls.at(-1)).toBe(`Basic ${btoa('client:secret')}`)
    const stored = await bindings.DB.prepare(
      'SELECT oidc_config FROM sso_provider WHERE provider_id = ?'
    )
      .bind('good-co')
      .first<{ oidc_config: string }>()
    expect(stored!.oidc_config).toContain('enc:v1:')
    expect(stored!.oidc_config).not.toContain('"secret"')
    const person = await bindings.DB.prepare('SELECT email FROM user WHERE email = ?')
      .bind('ada@good-co.example')
      .first()
    expect(person).not.toBeNull()
  })

  it('does not sign in someone whose address is at another domain', async () => {
    await fakeIdp(() => ({ sub: 'idp-2', email: 'ada@evil.example', email_verified: true }))
    const s = setup()
    await setupCompany(s, true, 'mix-co')
    const { path, cookie } = await startLogin(s, 'mix-co')
    const back = await s.call(path, { headers: { cookie } })
    expect(back.headers.getSetCookie().join(';')).not.toContain('session_token')
    const person = await bindings.DB.prepare('SELECT email FROM user WHERE email = ?')
      .bind('ada@evil.example')
      .first()
    expect(person).toBeNull()
  })

  it('does not take over an existing account when the domain was never proven', async () => {
    await fakeIdp(() => ({ sub: 'idp-3', email: 'ada@unproven-co.example', email_verified: true }))
    const s = setup()
    await signIn(s, 'ada@unproven-co.example')
    await setupCompany(s, false, 'unproven-co')
    const start = await s.call('/api/auth/sign-in/sso', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ email: 'ada@unproven-co.example', callbackURL: '/app' })
    })
    expect(start.status).toBe(401)
  })
})

describe('suspension and the session cache', () => {
  it('stops a suspended person on every route at once, even with a cached session', async () => {
    const s = setup()
    const cookie = await signIn(s, 'cached@example.com')
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(200)
    // Suspend without touching the sessions, as if the cookie were still inside its cache window.
    await bindings.DB.prepare('UPDATE user SET banned = 1 WHERE email = ?')
      .bind('cached@example.com')
      .run()
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(401)
    expect((await s.call('/api/account', { headers: { cookie } })).status).toBe(401)
  })

  it('lets a person back in once a timed suspension has ended', async () => {
    const s = setup()
    const cookie = await signIn(s, 'timed@example.com')
    await bindings.DB.prepare('UPDATE user SET banned = 1, ban_expires = ? WHERE email = ?')
      .bind(Date.now() - 1000, 'timed@example.com')
      .run()
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(200)
  })

  it('stops a revoked session on cached routes at once', async () => {
    const s = setup()
    const cookie = await signIn(s, 'revoked@example.com')
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(200)
    await bindings.DB.prepare(
      'DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = ?)'
    )
      .bind('revoked@example.com')
      .run()
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(401)
  })

  it('never lets two API keys share a hash', async () => {
    const s = setup()
    const cookie = await signIn(s, 'dupe@example.com')
    const made = await s.call('/api/auth/api-key/create', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'one' })
    })
    const { id } = (await made.json()) as { id: string }
    const copy = bindings.DB.prepare(
      "INSERT INTO apikey (id, reference_id, key, created_at, updated_at) SELECT 'copy', reference_id, key, 1, 1 FROM apikey WHERE id = ?"
    ).bind(id)
    await expect(copy.run()).rejects.toThrow(/UNIQUE/i)
  })
})

describe('directory sync (SCIM)', () => {
  const json = { 'content-type': 'application/json' }
  const U = 'urn:ietf:params:scim:schemas:core:2.0:User'
  const G = 'urn:ietf:params:scim:schemas:core:2.0:Group'
  const PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
  let n = 0

  /** A team with an owner and a directory connection; returns what a directory needs. */
  async function connect(s: ReturnType<typeof setup>, slug?: string) {
    n++
    const ownerEmail = `scim-owner-${n}@example.com`
    const owner = await signIn(s, ownerEmail)
    const made = await s.call('/api/auth/organization/create', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ name: `Dir ${n}`, slug: slug ?? `dir-${n}-${Date.now()}` })
    })
    const team = (await made.json()) as { id: string }
    // A directory may only provision addresses at a domain the team has proven.
    await bindings.DB.prepare(
      "INSERT INTO sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified) SELECT ?, 'https://idp.dir', id, ?, ?, 'dir.example', 1 FROM user WHERE email = ?"
    )
      .bind(crypto.randomUUID(), `dir-${n}-${crypto.randomUUID()}`, team.id, ownerEmail)
      .run()
    const conn = await s.call('/api/scim-connections', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ organizationId: team.id, name: 'Okta' })
    })
    expect(conn.status).toBe(201)
    const body = (await conn.json()) as { id: string; token: string }
    return { owner, ownerEmail, team, connectionId: body.id, token: body.token }
  }
  const scim = (
    s: ReturnType<typeof setup>,
    token: string | null,
    path: string,
    method = 'GET',
    body?: unknown
  ): Promise<Response> =>
    s.call(`/api/scim/v2${path}`, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/scim+json' })
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  const person = (email: string, extra: Record<string, unknown> = {}) => ({
    schemas: [U],
    userName: email,
    externalId: `ext-${email}`,
    name: { givenName: 'Test', familyName: 'Person' },
    emails: [{ value: email, primary: true, type: 'work' }],
    ...extra
  })
  const memberOf = async (teamId: string, email: string): Promise<boolean> =>
    Boolean(
      await bindings.DB.prepare(
        'SELECT m.id FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ?'
      )
        .bind(teamId, email)
        .first()
    )

  it('lets only the team owner make tokens, shows a token once, and stores only a hash', async () => {
    const s = setup()
    const { owner, team, connectionId, token } = await connect(s)
    expect(token).toMatch(/^scim_/)
    const stored = await bindings.DB.prepare(
      'SELECT hash FROM scim_credential WHERE connection_id = ?'
    )
      .bind(connectionId)
      .first<{ hash: string }>()
    expect(stored!.hash).not.toContain(token)
    const listed = await s.call(`/api/scim-connections?organizationId=${team.id}`, {
      headers: { cookie: owner }
    })
    expect(JSON.stringify(await listed.json())).not.toContain(token)

    // A plain member and a stranger cannot manage it.
    const member = await signIn(s, `scim-member-${n}@example.com`)
    await bindings.DB.prepare(
      "INSERT INTO member (id, organization_id, user_id, role, created_at) SELECT 'mm-' || id, ?, id, 'member', 1 FROM user WHERE email = ?"
    )
      .bind(team.id, `scim-member-${n}@example.com`)
      .run()
    for (const cookie of [member, await signIn(s, `scim-stranger-${n}@example.com`)]) {
      const refused = await s.call('/api/scim-connections', {
        method: 'POST',
        headers: { cookie, ...json },
        body: JSON.stringify({ organizationId: team.id, name: 'x' })
      })
      expect(refused.status).toBe(403)
    }
  })

  it('answers discovery in public and refuses missing, wrong, revoked and expired tokens', async () => {
    const s = setup()
    const { owner, connectionId, token } = await connect(s)
    const config = await scim(s, null, '/ServiceProviderConfig')
    expect(config.status).toBe(200)
    expect(config.headers.get('content-type')).toContain('application/scim+json')
    expect(((await config.json()) as { patch: { supported: boolean } }).patch.supported).toBe(true)
    expect((await scim(s, null, '/Schemas')).status).toBe(200)
    expect((await scim(s, null, '/ResourceTypes/User')).status).toBe(200)

    expect((await scim(s, null, '/Users')).status).toBe(401)
    expect((await scim(s, 'scim_wrong', '/Users')).status).toBe(401)
    expect((await scim(s, token, '/Users')).status).toBe(200)

    await bindings.DB.prepare('UPDATE scim_credential SET expires_at = 1 WHERE connection_id = ?')
      .bind(connectionId)
      .run()
    expect((await scim(s, token, '/Users')).status).toBe(401)

    // Rotation: a second token works while the first is revoked.
    const second = await s.call(`/api/scim-connections/${connectionId}/credentials`, {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ expiresInDays: 30 })
    })
    const { token: fresh, credentialId } = (await second.json()) as {
      token: string
      credentialId: string
    }
    expect((await scim(s, fresh, '/Users')).status).toBe(200)
    const revoked = await s.call(
      `/api/scim-connections/${connectionId}/credentials/${credentialId}`,
      {
        method: 'DELETE',
        headers: { cookie: owner }
      }
    )
    expect(revoked.status).toBe(204)
    expect((await scim(s, fresh, '/Users')).status).toBe(401)
  })

  it('provisions a person, finds them by filter, and refuses duplicates', async () => {
    const s = setup()
    const { team, token } = await connect(s)
    const made = await scim(s, token, '/Users', 'POST', person('new.hire@dir.example'))
    expect(made.status).toBe(201)
    const created = (await made.json()) as {
      id: string
      userName: string
      active: boolean
      meta: { location: string }
    }
    expect(created.active).toBe(true)
    expect(created.meta.location).toContain(`/Users/${created.id}`)
    expect(await memberOf(team.id, 'new.hire@dir.example')).toBe(true)
    const account = await bindings.DB.prepare('SELECT email_verified FROM user WHERE email = ?')
      .bind('new.hire@dir.example')
      .first<{ email_verified: number }>()
    expect(account!.email_verified).toBe(0)

    const found = await scim(
      s,
      token,
      `/Users?filter=${encodeURIComponent('userName eq "NEW.HIRE@dir.example"')}`
    )
    const list = (await found.json()) as { totalResults: number; Resources: { id: string }[] }
    expect(list.totalResults).toBe(1)
    expect(list.Resources[0]!.id).toBe(created.id)
    const none = await scim(
      s,
      token,
      `/Users?filter=${encodeURIComponent('userName eq "nobody@dir.example"')}`
    )
    expect(((await none.json()) as { totalResults: number }).totalResults).toBe(0)

    const dupe = await scim(
      s,
      token,
      '/Users',
      'POST',
      person('new.hire@dir.example', { externalId: 'other' })
    )
    expect(dupe.status).toBe(409)
    expect(((await dupe.json()) as { scimType: string }).scimType).toBe('uniqueness')
    const badFilter = await scim(s, token, `/Users?filter=${encodeURIComponent('userName pr')}`)
    expect(badFilter.status).toBe(400)
    expect(((await badFilter.json()) as { scimType: string }).scimType).toBe('invalidFilter')
    expect((await scim(s, token, '/Users/no-such-id')).status).toBe(404)
    const paged = await scim(s, token, '/Users?count=0')
    expect(((await paged.json()) as { Resources: unknown[] }).Resources).toHaveLength(0)
  })

  it('shows what the directory says about a person in their data export', async () => {
    const s = setup()
    const { token } = await connect(s)
    await scim(s, token, '/Users', 'POST', person('exported@dir.example'))
    const cookie = await signIn(s, 'exported@dir.example')
    const out = await s.call('/api/account/export', { headers: { cookie } })
    const body = (await out.json()) as { directory: { userName: string; active: boolean }[] }
    expect(body.directory).toEqual([
      expect.objectContaining({ userName: 'exported@dir.example', active: true })
    ])
  })

  it('does not adopt an existing account unless the team proved the domain', async () => {
    const s = setup()
    const { team, token } = await connect(s)
    await signIn(s, 'already@proved.example')
    const refused = await scim(s, token, '/Users', 'POST', person('already@proved.example'))
    expect(refused.status).toBe(403)
    expect(await memberOf(team.id, 'already@proved.example')).toBe(false)

    await bindings.DB.prepare(
      "INSERT INTO sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified) SELECT ?, 'https://idp.x', id, ?, ?, 'proved.example', 1 FROM user WHERE email = ?"
    )
      .bind(`sp-${n}`, `scim-proved-${n}`, team.id, 'already@proved.example')
      .run()
    const adopted = await scim(s, token, '/Users', 'POST', person('already@proved.example'))
    expect(adopted.status).toBe(201)
    expect(await memberOf(team.id, 'already@proved.example')).toBe(true)
  })

  it('switches a person off and on, ending access only when the directory created the account', async () => {
    const s = setup()
    const { team, token } = await connect(s)
    const email = 'leaver@dir.example'
    const { id } = (await (await scim(s, token, '/Users', 'POST', person(email))).json()) as {
      id: string
    }
    // The person has a session (as if they had signed in).
    const cookie = await signIn(s, email)
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(200)

    const off = await scim(s, token, `/Users/${id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }]
    })
    expect(off.status).toBe(200)
    expect(((await off.json()) as { active: boolean }).active).toBe(false)
    expect(await memberOf(team.id, email)).toBe(false)
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(401)
    const banned = await bindings.DB.prepare('SELECT banned, ban_reason FROM user WHERE email = ?')
      .bind(email)
      .first<{ banned: number; ban_reason: string }>()
    expect(banned).toMatchObject({ banned: 1, ban_reason: 'deprovisioned' })

    const on = await scim(s, token, `/Users/${id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'replace', value: { active: true } }]
    })
    expect(on.status).toBe(200)
    expect(await memberOf(team.id, email)).toBe(true)
    const back = await bindings.DB.prepare('SELECT banned FROM user WHERE email = ?')
      .bind(email)
      .first<{ banned: number }>()
    expect(back!.banned).toBe(0)

    // Deleting the directory record keeps the account.
    expect((await scim(s, token, `/Users/${id}`, 'DELETE')).status).toBe(204)
    expect((await scim(s, token, `/Users/${id}`)).status).toBe(404)
    expect(
      await bindings.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first()
    ).not.toBeNull()
  })

  it('never removes the team owner, and an existing account is not suspended', async () => {
    const s = setup()
    const { team, token, ownerEmail } = await connect(s)
    await bindings.DB.prepare('UPDATE sso_provider SET id = id WHERE 0').run()
    await bindings.DB.prepare(
      "INSERT INTO sso_provider (id, issuer, user_id, provider_id, organization_id, domain, domain_verified) SELECT ?, 'https://idp.x', id, ?, ?, 'example.com', 1 FROM user WHERE email = ?"
    )
      .bind(`sp-o-${n}`, `scim-owner-p-${n}`, team.id, ownerEmail)
      .run()
    const { id } = (await (await scim(s, token, '/Users', 'POST', person(ownerEmail))).json()) as {
      id: string
    }
    await scim(s, token, `/Users/${id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }]
    })
    expect(await memberOf(team.id, ownerEmail)).toBe(true)
    const row = await bindings.DB.prepare('SELECT banned FROM user WHERE email = ?')
      .bind(ownerEmail)
      .first<{ banned: number }>()
    expect(row!.banned).toBe(0)
  })

  it('replaces with PUT, changes the email (unverified again) and refuses an address in use', async () => {
    const s = setup()
    const { token } = await connect(s)
    const a = (await (
      await scim(s, token, '/Users', 'POST', person('put.a@dir.example'))
    ).json()) as { id: string }
    await scim(s, token, '/Users', 'POST', person('put.b@dir.example'))
    const clash = await scim(
      s,
      token,
      `/Users/${a.id}`,
      'PUT',
      person('put.b@dir.example', { externalId: 'ext-new' })
    )
    expect(clash.status).toBe(409)
    const moved = await scim(
      s,
      token,
      `/Users/${a.id}`,
      'PUT',
      person('put.c@dir.example', { externalId: 'ext-put-a' })
    )
    expect(moved.status).toBe(200)
    expect(
      await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
        .bind('put.c@dir.example')
        .first()
    ).not.toBeNull()
    expect(
      await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
        .bind('put.a@dir.example')
        .first()
    ).toBeNull()
  })

  it('brings back the same person when the directory creates them again', async () => {
    const s = setup()
    const { team, token } = await connect(s)
    const email = 'comeback@dir.example'
    const first = (await (await scim(s, token, '/Users', 'POST', person(email))).json()) as {
      id: string
    }
    await scim(s, token, `/Users/${first.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }]
    })
    // Same externalId and a new userName spelling: the same record is reused and reactivated.
    const again = await scim(
      s,
      token,
      '/Users',
      'POST',
      person(email.toUpperCase().replace('@DIR.EXAMPLE', '@dir.example'))
    )
    expect([201, 409]).toContain(again.status)
    const second = await scim(
      s,
      token,
      '/Users',
      'POST',
      person(email, { userName: 'comeback2@dir.example' })
    )
    if (second.status === 201) {
      expect(((await second.json()) as { id: string }).id).toBe(first.id)
      expect(await memberOf(team.id, email)).toBe(true)
    }
  })

  it('handles groups: create, members, patch, list and delete', async () => {
    const s = setup()
    const { token } = await connect(s)
    const u1 = (await (
      await scim(s, token, '/Users', 'POST', person('g1@dir.example'))
    ).json()) as { id: string }
    const u2 = (await (
      await scim(s, token, '/Users', 'POST', person('g2@dir.example'))
    ).json()) as { id: string }
    const made = await scim(s, token, '/Groups', 'POST', {
      schemas: [G],
      displayName: 'Engineers',
      members: [{ value: u1.id }]
    })
    expect(made.status).toBe(201)
    const group = (await made.json()) as { id: string; members: { value: string }[] }
    expect(group.members.map((m) => m.value)).toEqual([u1.id])

    expect(
      (await scim(s, token, '/Groups', 'POST', { schemas: [G], displayName: 'engineers' })).status
    ).toBe(409)
    expect(
      (
        await scim(s, token, '/Groups', 'POST', {
          schemas: [G],
          displayName: 'Bad',
          members: [{ value: 'nope' }]
        })
      ).status
    ).toBe(400)

    const patched = await scim(s, token, `/Groups/${group.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [
        { op: 'add', path: 'members', value: [{ value: u2.id }] },
        { op: 'remove', path: `members[value eq "${u1.id}"]` }
      ]
    })
    expect(patched.status).toBe(200)
    expect(
      ((await patched.json()) as { members: { value: string }[] }).members.map((m) => m.value)
    ).toEqual([u2.id])

    const put = await scim(s, token, `/Groups/${group.id}`, 'PUT', {
      schemas: [G],
      displayName: 'Engineering',
      members: [{ value: u1.id }, { value: u2.id }]
    })
    expect(((await put.json()) as { members: unknown[] }).members).toHaveLength(2)

    const list = await scim(
      s,
      token,
      `/Groups?filter=${encodeURIComponent('displayName eq "engineering"')}`
    )
    expect(((await list.json()) as { totalResults: number }).totalResults).toBe(1)
    expect((await scim(s, token, `/Groups/${group.id}`, 'DELETE')).status).toBe(204)
    expect((await scim(s, token, `/Groups/${group.id}`)).status).toBe(404)
    // Deleting a group leaves its people alone.
    expect((await scim(s, token, `/Users/${u1.id}`)).status).toBe(200)
  })

  it('keeps each team’s directory apart and honours scopes', async () => {
    const s = setup()
    const a = await connect(s)
    const b = await connect(s)
    const mine = (await (
      await scim(s, a.token, '/Users', 'POST', person('iso@dir.example'))
    ).json()) as { id: string }
    expect((await scim(s, b.token, `/Users/${mine.id}`)).status).toBe(404)
    expect(
      ((await (await scim(s, b.token, '/Users')).json()) as { totalResults: number }).totalResults
    ).toBe(0)

    await bindings.DB.prepare(
      "UPDATE scim_credential SET scopes = 'scim.users.read' WHERE connection_id = ?"
    )
      .bind(a.connectionId)
      .run()
    expect((await scim(s, a.token, '/Users')).status).toBe(200)
    expect((await scim(s, a.token, '/Users', 'POST', person('scope@dir.example'))).status).toBe(403)
    expect((await scim(s, a.token, '/Groups')).status).toBe(403)
  })

  it('does not let a switched-off person rejoin the team', async () => {
    const s = setup()
    const { owner, team, token } = await connect(s)
    const email = 'rejoin@dir.example'
    const made = (await (await scim(s, token, '/Users', 'POST', person(email))).json()) as {
      id: string
    }
    await scim(s, token, `/Users/${made.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }]
    })
    // Lift the suspension, as if they had other access; the invitation must still be refused.
    await bindings.DB.prepare('UPDATE user SET banned = 0 WHERE email = ?').bind(email).run()
    const before = s.sent.length
    await s.call('/api/auth/organization/invite-member', {
      method: 'POST',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ email, role: 'member', organizationId: team.id })
    })
    const id = /accept-invitation\/([\w-]+)/.exec(s.sent[before]!.text)![1]!
    const cookie = await signIn(s, email)
    const accept = await s.call('/api/auth/organization/accept-invitation', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ invitationId: id })
    })
    expect(accept.status).toBeGreaterThanOrEqual(400)
    expect(await memberOf(team.id, email)).toBe(false)
  })

  it('removes the directory records with the connection and with the team', async () => {
    const s = setup()
    const { owner, team, connectionId, token } = await connect(s)
    await scim(s, token, '/Users', 'POST', person('gone@dir.example'))
    const removed = await s.call(`/api/scim-connections/${connectionId}`, {
      method: 'DELETE',
      headers: { cookie: owner }
    })
    expect(removed.status).toBe(204)
    expect((await scim(s, token, '/Users')).status).toBe(401)
    const rows = await bindings.DB.prepare(
      'SELECT COUNT(*) AS n FROM scim_user WHERE connection_id = ?'
    )
      .bind(connectionId)
      .first<{ n: number }>()
    expect(rows!.n).toBe(0)
    // The sign-in account and the team membership stay.
    expect(
      await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
        .bind('gone@dir.example')
        .first()
    ).not.toBeNull()
    expect(await memberOf(team.id, 'gone@dir.example')).toBe(true)
  })

  it('does not recreate an account the person deleted, until an owner allows it', async () => {
    const s = setup()
    const { owner, team, connectionId, token } = await connect(s)
    const email = `tomb-${Date.now()}@dir.example`
    expect((await scim(s, token, '/Users', 'POST', person(email))).status).toBe(201)
    const cookie = await signIn(s, email)
    await s.call('/api/account', {
      method: 'DELETE',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ confirmEmail: email })
    })
    await deleteDueAccounts(createDb(bindings.DB), Date.now() + 30 * 86_400_000)
    const gone = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first()
    expect(gone).toBeNull()
    // The directory's next sync is refused, and what is kept is a hash, not the address.
    const refused = await scim(s, token, '/Users', 'POST', person(email))
    expect(refused.status).toBe(409)
    const kept = await bindings.DB.prepare(
      'SELECT email_hash FROM scim_tombstone WHERE organization_id = ?'
    )
      .bind(team.id)
      .all<{ email_hash: string }>()
    expect(kept.results).toHaveLength(1)
    expect(kept.results[0]!.email_hash).not.toContain('tomb-')

    const listed = (await (
      await s.call(`/api/scim-connections?organizationId=${team.id}`, {
        headers: { cookie: owner }
      })
    ).json()) as { connections: { blocked: number }[] }
    expect(listed.connections[0]!.blocked).toBe(1)
    const cleared = await s.call(`/api/scim-connections/${connectionId}/tombstones`, {
      method: 'DELETE',
      headers: { cookie: owner }
    })
    expect(cleared.status).toBe(204)
    expect((await scim(s, token, '/Users', 'POST', person(email))).status).toBe(201)
  })

  it('only provisions and re-addresses accounts at a domain the team has proven', async () => {
    const s = setup()
    const { team, token } = await connect(s)
    // A stranger's address at some other domain: no account is made and nobody is added.
    const stranger = `victim-${Date.now()}@gmail.example`
    const refused = await scim(s, token, '/Users', 'POST', person(stranger))
    expect(refused.status).toBe(403)
    expect(
      await bindings.DB.prepare('SELECT id FROM user WHERE email = ?').bind(stranger).first()
    ).toBeNull()
    expect(await memberOf(team.id, stranger)).toBe(false)

    // At the proven domain it works, and the address cannot be moved to another domain afterwards.
    const email = `ok-${Date.now()}@dir.example`
    const created = (await (await scim(s, token, '/Users', 'POST', person(email))).json()) as {
      id: string
    }
    const cookie = await signIn(s, email)
    const moved = await scim(s, token, `/Users/${created.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [
        {
          op: 'replace',
          path: 'emails',
          value: [{ value: 'attacker@evil.example', primary: true, type: 'work' }]
        }
      ]
    })
    expect(moved.status).toBe(403)
    const still = await bindings.DB.prepare(
      'SELECT email FROM user WHERE id = (SELECT user_id FROM scim_user WHERE id = ?)'
    )
      .bind(created.id)
      .first<{ email: string }>()
    expect(still?.email).toBe(email)
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(200)

    // Inside the domain it is allowed, and the old sign-ins end.
    const renamed = `renamed-${Date.now()}@dir.example`
    const ok = await scim(s, token, `/Users/${created.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [
        { op: 'replace', path: 'emails', value: [{ value: renamed, primary: true, type: 'work' }] }
      ]
    })
    expect(ok.status).toBe(200)
    expect((await s.call('/api/preferences', { headers: { cookie } })).status).toBe(401)
  })

  it('makes people in a group team admins only when an owner says so, and takes it back', async () => {
    const s = setup()
    const { owner, team, connectionId, token } = await connect(s)
    const email = `role-${Date.now()}@dir.example`
    const created = (await (await scim(s, token, '/Users', 'POST', person(email))).json()) as {
      id: string
    }
    const group = (await (
      await scim(s, token, '/Groups', 'POST', {
        schemas: [G],
        displayName: 'Admins',
        members: [{ value: created.id }]
      })
    ).json()) as { id: string }
    const role = async (): Promise<string | undefined> =>
      (
        await bindings.DB.prepare(
          'SELECT m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ?'
        )
          .bind(team.id, email)
          .first<{ role: string }>()
      )?.role
    // A group grants nothing by default.
    expect(await role()).toBe('member')

    // Nobody but a team owner can turn it on.
    const member = await signIn(s, email)
    const refused = await s.call(`/api/scim-connections/${connectionId}/groups/${group.id}`, {
      method: 'PUT',
      headers: { cookie: member, ...json },
      body: JSON.stringify({ grantsAdmin: true })
    })
    expect(refused.status).toBeGreaterThanOrEqual(400)
    expect(await role()).toBe('member')

    const on = await s.call(`/api/scim-connections/${connectionId}/groups/${group.id}`, {
      method: 'PUT',
      headers: { cookie: owner, ...json },
      body: JSON.stringify({ grantsAdmin: true })
    })
    expect(on.status).toBe(204)
    expect(await role()).toBe('admin')

    // Leaving the group takes the rights back.
    const patched = await scim(s, token, `/Groups/${group.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'remove', path: 'members' }]
    })
    expect(patched.status).toBe(200)
    expect(await role()).toBe('member')

    // Back in the group, then switched off in the directory: rights go with the person.
    await scim(s, token, `/Groups/${group.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'add', path: 'members', value: [{ value: created.id }] }]
    })
    expect(await role()).toBe('admin')
    await scim(s, token, `/Users/${created.id}`, 'PATCH', {
      schemas: [PATCH],
      Operations: [{ op: 'replace', path: 'active', value: false }]
    })
    expect(await memberOf(team.id, email)).toBe(false)
  })

  it('never changes a team owner through a group', async () => {
    const s = setup()
    const { ownerEmail, team, connectionId, token } = await connect(s)
    const created = (await (await scim(s, token, '/Users', 'POST', person(ownerEmail))).json()) as {
      id: string
    }
    const group = (await (
      await scim(s, token, '/Groups', 'POST', {
        schemas: [G],
        displayName: 'Everyone',
        members: [{ value: created.id }]
      })
    ).json()) as { id: string }
    const sameOwner = await signIn(s, ownerEmail)
    await s.call(`/api/scim-connections/${connectionId}/groups/${group.id}`, {
      method: 'PUT',
      headers: { cookie: sameOwner, ...json },
      body: JSON.stringify({ grantsAdmin: true })
    })
    await scim(s, token, `/Groups/${group.id}`, 'DELETE')
    const row = await bindings.DB.prepare(
      'SELECT m.role FROM member m JOIN user u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ?'
    )
      .bind(team.id, ownerEmail)
      .first<{ role: string }>()
    expect(row?.role).toBe('owner')
  })
})

describe('AI apps (MCP): OAuth sign-in and the /api/mcp endpoint', () => {
  const json = { 'content-type': 'application/json' }
  const CLIENT_ID = 'https://assistant.example/client.json'
  const REDIRECT = 'http://127.0.0.1:8765/callback'
  const RESOURCE = `${ORIGIN}/api/mcp`
  const b64url = (bytes: ArrayBuffer): string => {
    let text = ''
    for (const b of new Uint8Array(bytes)) text += String.fromCharCode(b)
    return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  }

  /** Pretend the AI app's metadata document is published at its own address. */
  function publishClient(extra: Record<string, unknown> = {}): void {
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (url === CLIENT_ID)
        return Response.json({
          client_id: CLIENT_ID,
          client_name: 'Test Assistant',
          redirect_uris: [REDIRECT],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          token_endpoint_auth_method: 'none',
          ...extra
        })
      return real(input, init)
    })
  }
  afterEach(() => vi.restoreAllMocks())

  async function authorize(
    s: ReturnType<typeof setup>,
    cookie: string,
    scope = 'openid offline_access mcp:read'
  ): Promise<{ response: Response; verifier: string }> {
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)).buffer)
    const challenge = b64url(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    )
    const query = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope,
      state: 'xyz',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE
    })
    const response = await s.call(`/api/auth/oauth2/authorize?${query}`, {
      headers: cookie ? { cookie } : {}
    })
    return { response, verifier }
  }

  /** Runs sign-in, consent and the token request; returns the tokens. */
  async function getTokens(
    s: ReturnType<typeof setup>,
    cookie: string,
    scope?: string,
    tokenHeaders: Record<string, string> = {}
  ): Promise<{ access_token: string; refresh_token: string; token_type?: string }> {
    const { response, verifier } = await authorize(s, cookie, scope)
    expect(response.status).toBe(302)
    const consentUrl = new URL(response.headers.get('location')!, ORIGIN)
    expect(consentUrl.pathname).toBe('/consent')
    const accepted = await s.call('/api/auth/oauth2/consent', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ accept: true, oauth_query: consentUrl.search.slice(1) })
    })
    expect(accepted.status).toBe(200)
    const { url } = (await accepted.json()) as { url: string }
    const back = new URL(url)
    expect(`${back.origin}${back.pathname}`).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('xyz')
    const token = await s.call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...tokenHeaders },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: back.searchParams.get('code')!,
        code_verifier: verifier,
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        resource: RESOURCE
      }).toString()
    })
    expect(token.status).toBe(200)
    return (await token.json()) as {
      access_token: string
      refresh_token: string
      token_type?: string
    }
  }

  const call = (
    s: ReturnType<typeof setup>,
    token: string | null,
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<Response> =>
    s.call('/api/mcp', {
      method: 'POST',
      headers: {
        ...json,
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(typeof params.name === 'string' ? { 'mcp-name': params.name } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {}
          }
        }
      })
    })

  it('publishes where to sign in, and challenges a call without a token', async () => {
    const s = setup()
    const meta = await s.call('/api/__discovery/.well-known/oauth-protected-resource/api/mcp')
    expect(meta.status).toBe(200)
    expect(await meta.json()).toMatchObject({ resource: RESOURCE })
    const server = await s.call('/api/__discovery/.well-known/oauth-authorization-server/api/auth')
    expect(server.status).toBe(200)
    const body = (await server.json()) as Record<string, unknown>
    expect(body.authorization_endpoint).toContain('/oauth2/authorize')
    // Nobody can register a client by themselves.
    expect(body.registration_endpoint).toBeUndefined()

    const refused = await call(s, null, 'tools/list')
    expect(refused.status).toBe(401)
    expect(refused.headers.get('www-authenticate')).toContain('resource_metadata')
  })

  it('sends a signed-out person to sign in, then to the consent page', async () => {
    publishClient()
    const s = setup()
    const { response } = await authorize(s, '')
    expect(response.status).toBe(302)
    const login = new URL(response.headers.get('location')!, ORIGIN)
    expect(login.pathname).toBe('/sign-in')
    expect(login.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(login.searchParams.get('sig')).toBeTruthy()
  })

  it('runs the whole flow: consent, token, tools, refresh', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-person@example.com')
    const tokens = await getTokens(s, cookie)
    expect(tokens.refresh_token).toBeTruthy()

    const list = await call(s, tokens.access_token, 'tools/list')
    expect(list.status).toBe(200)
    const listed = await list.text()
    for (const name of ['whoami', 'list_teams', 'list_devices', 'recent_security_activity'])
      expect(listed).toContain(name)

    const who = await call(s, tokens.access_token, 'tools/call', { name: 'whoami', arguments: {} })
    expect(who.status).toBe(200)
    expect(await who.text()).toContain('mcp-person@example.com')

    // The refresh token works once; the old one is dead afterwards.
    const refresh = (token: string): Promise<Response> =>
      s.call('/api/auth/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: token,
          client_id: CLIENT_ID,
          resource: RESOURCE
        }).toString()
      })
    const next = await refresh(tokens.refresh_token)
    expect(next.status).toBe(200)
    expect((await refresh(tokens.refresh_token)).status).toBeGreaterThanOrEqual(400)
  })

  it('shows only the signed-in person’s data, and stops at once for a suspended person', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-suspend@example.com')
    const tokens = await getTokens(s, cookie)
    expect((await call(s, tokens.access_token, 'tools/list')).status).toBe(200)
    await bindings.DB.prepare('UPDATE user SET banned = 1 WHERE email = ?')
      .bind('mcp-suspend@example.com')
      .run()
    expect((await call(s, tokens.access_token, 'tools/list')).status).toBe(401)
  })

  it('refuses a token for another resource, a missing scope and a forged token', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-scope@example.com')
    const { response } = await authorize(s, cookie, 'openid')
    // Without the mcp:read scope the consent screen is still shown, but the token cannot call the tool endpoint.
    expect(response.status).toBe(302)
    expect((await call(s, 'not-a-token', 'tools/list')).status).toBe(401)
    const parts = (await getTokens(s, await signIn(s, 'mcp-forge@example.com'))).access_token.split(
      '.'
    )
    parts[2] = 'AAAA'
    expect((await call(s, parts.join('.'), 'tools/list')).status).toBe(401)
  })

  it('lists approved apps, records approval and removal, and lets the person remove one', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-apps@example.com')
    const tokens = await getTokens(s, cookie)

    const listed = await s.call('/api/auth/oauth2/get-consents', { headers: { cookie } })
    expect(listed.status).toBe(200)
    const rows = (await listed.json()) as { id: string; clientId: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.clientId).toBe(CLIENT_ID)

    const named = await s.call(
      `/api/auth/oauth2/public-client?client_id=${encodeURIComponent(CLIENT_ID)}`,
      { headers: { cookie } }
    )
    expect(named.status).toBe(200)
    expect(await named.json()).toMatchObject({ client_name: 'Test Assistant' })

    const exported = (await (
      await s.call('/api/account/export', { headers: { cookie } })
    ).json()) as {
      connectedApps: { clientId: string }[]
      securityActivity: { type: string }[]
    }
    expect(exported.connectedApps.map((a) => a.clientId)).toEqual([CLIENT_ID])
    expect(exported.securityActivity.map((e) => e.type)).toContain('app_connected')
    expect(JSON.stringify(exported)).not.toContain(tokens.access_token)

    const removed = await s.call('/api/auth/oauth2/delete-consent', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ id: rows[0]!.id })
    })
    expect(removed.status).toBe(200)
    const after = (await (
      await s.call('/api/auth/oauth2/get-consents', { headers: { cookie } })
    ).json()) as unknown[]
    expect(after).toHaveLength(0)
  })

  it('refuses a token without the mcp:read scope', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-noscope@example.com')
    const tokens = await getTokens(s, cookie, 'openid offline_access')
    expect((await call(s, tokens.access_token, 'tools/list')).status).toBe(403)
  })

  it('does not hand out a code for a bad redirect address or without PKCE', async () => {
    const s = setup()
    const cookie = await signIn(s, 'mcp-redirect@example.com')
    const base = {
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid mcp:read',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      resource: RESOURCE
    }
    const location = async (query: Record<string, string>): Promise<string> => {
      const r = await s.call(`/api/auth/oauth2/authorize?${new URLSearchParams(query)}`, {
        headers: { cookie }
      })
      return r.headers.get('location') ?? ''
    }
    publishClient({ redirect_uris: ['javascript:alert(1)'] })
    expect(await location({ ...base, redirect_uri: 'javascript:alert(1)' })).not.toContain(
      '/consent'
    )
    vi.restoreAllMocks()
    publishClient()
    // A redirect address the app did not list.
    expect(await location({ ...base, redirect_uri: 'https://evil.example/cb' })).not.toContain(
      '/consent'
    )
    // No PKCE challenge.
    const noPkce: Record<string, string> = { ...base }
    delete noPkce.code_challenge
    delete noPkce.code_challenge_method
    expect(await location(noPkce)).not.toContain('/consent')
  })

  it('cuts an app off when the person is suspended or signs out everywhere', async () => {
    publishClient()
    const s = setup()
    await signIn(s, 'mcp-boss@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('mcp-boss@example.com')
      .run()
    const staffCookie = await signIn(s, 'mcp-boss@example.com')
    const victim = await signIn(s, 'mcp-victim@example.com')
    await getTokens(s, victim)
    const row = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('mcp-victim@example.com')
      .first<{ id: string }>()
    const count = async (): Promise<number> =>
      (await bindings.DB.prepare('SELECT COUNT(*) AS n FROM oauth_consent WHERE user_id = ?')
        .bind(row!.id)
        .first<{ n: number }>())!.n
    expect(await count()).toBe(1)
    const ban = await s.call('/api/auth/admin/ban-user', {
      method: 'POST',
      headers: { cookie: staffCookie, ...json },
      body: JSON.stringify({ userId: row!.id })
    })
    expect(ban.status).toBe(200)
    expect(await count()).toBe(0)
    const refreshLeft = await bindings.DB.prepare(
      'SELECT COUNT(*) AS n FROM oauth_refresh_token WHERE user_id = ?'
    )
      .bind(row!.id)
      .first<{ n: number }>()
    expect(refreshLeft!.n).toBe(0)

    const other = await signIn(s, 'mcp-everywhere@example.com')
    await getTokens(s, other)
    const mine = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind('mcp-everywhere@example.com')
      .first<{ id: string }>()
    const out = await s.call('/api/auth/revoke-sessions', {
      method: 'POST',
      headers: { cookie: other, ...json },
      body: '{}'
    })
    expect(out.status).toBe(200)
    const left = await bindings.DB.prepare(
      'SELECT COUNT(*) AS n FROM oauth_consent WHERE user_id = ?'
    )
      .bind(mine!.id)
      .first<{ n: number }>()
    expect(left!.n).toBe(0)
  })

  async function staffCookieFor(
    s: ReturnType<typeof setup>,
    email: string,
    role: 'admin' | 'support'
  ): Promise<string> {
    await signIn(s, email)
    await bindings.DB.prepare('UPDATE user SET role = ? WHERE email = ?').bind(role, email).run()
    return signIn(s, email)
  }

  it('lets an admin list and switch off an AI app, and nobody else', async () => {
    publishClient()
    const s = setup()
    const person = await signIn(s, 'mcp-adm-person@example.com')
    const tokens = await getTokens(s, person)
    expect((await call(s, tokens.access_token, 'tools/list')).status).toBe(200)

    // Not staff, and support (read-only staff) are refused.
    expect((await s.call('/api/admin/ai-apps', { headers: { cookie: person } })).status).toBe(403)
    const support = await staffCookieFor(s, 'mcp-adm-support@example.com', 'support')
    expect((await s.call('/api/admin/ai-apps', { headers: { cookie: support } })).status).toBe(403)
    const refusedSwitch = await s.call('/api/admin/ai-apps/disable', {
      method: 'POST',
      headers: { cookie: support, ...json },
      body: JSON.stringify({ clientId: CLIENT_ID })
    })
    expect(refusedSwitch.status).toBe(403)
    expect((await s.call('/api/admin/ai-apps')).status).toBe(401)

    const admin = await staffCookieFor(s, 'mcp-adm-boss@example.com', 'admin')
    const listed = (await (
      await s.call('/api/admin/ai-apps', { headers: { cookie: admin } })
    ).json()) as { clientId: string; name: string; disabled: boolean; people: number }[]
    const mine = listed.find((a) => a.clientId === CLIENT_ID)
    expect(mine).toMatchObject({ name: 'Test Assistant', disabled: false })
    expect(mine!.people).toBeGreaterThanOrEqual(1)

    const unknown = await s.call('/api/admin/ai-apps/disable', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({ clientId: 'https://nobody.example/x.json' })
    })
    expect(unknown.status).toBe(404)
    expect(
      (
        await s.call('/api/admin/ai-apps/delete', {
          method: 'POST',
          headers: { cookie: admin, ...json },
          body: JSON.stringify({ clientId: CLIENT_ID })
        })
      ).status
    ).toBe(404)

    const off = await s.call('/api/admin/ai-apps/disable', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({ clientId: CLIENT_ID })
    })
    expect(off.status).toBe(200)

    // The token that worked a moment ago is refused at once, its approvals are gone, and the app cannot start over.
    expect((await call(s, tokens.access_token, 'tools/list')).status).toBe(401)
    const left = await bindings.DB.prepare(
      'SELECT (SELECT COUNT(*) FROM oauth_consent WHERE client_id = ?1) AS consents, (SELECT COUNT(*) FROM oauth_refresh_token WHERE client_id = ?1) AS refresh, (SELECT COUNT(*) FROM oauth_access_token WHERE client_id = ?1) AS access'
    )
      .bind(CLIENT_ID)
      .first<{ consents: number; refresh: number; access: number }>()
    expect(left).toEqual({ consents: 0, refresh: 0, access: 0 })
    const again = await authorize(s, person)
    expect(again.response.headers.get('location') ?? '').not.toContain('/consent')
    const listedOff = (await (
      await s.call('/api/admin/ai-apps', { headers: { cookie: admin } })
    ).json()) as { clientId: string; disabled: boolean }[]
    expect(listedOff.find((a) => a.clientId === CLIENT_ID)!.disabled).toBe(true)

    // Switching it on lets people approve it again.
    const on = await s.call('/api/admin/ai-apps/enable', {
      method: 'POST',
      headers: { cookie: admin, ...json },
      body: JSON.stringify({ clientId: CLIENT_ID })
    })
    expect(on.status).toBe(200)
    const back = await authorize(s, person)
    expect(new URL(back.response.headers.get('location')!, ORIGIN).pathname).toBe('/consent')

    const events = await bindings.DB.prepare(
      "SELECT type, actor_id FROM audit_event WHERE type IN ('ai_app_disabled', 'ai_app_enabled') ORDER BY at"
    ).all<{ type: string; actor_id: string | null }>()
    expect(events.results.map((e) => e.type)).toEqual(['ai_app_disabled', 'ai_app_enabled'])
    expect(events.results.every((e) => e.actor_id)).toBe(true)
    await forgetClient()
  })

  it('keeps the plugin client routes staff-only and nobody can create a client by hand', async () => {
    const s = setup()
    const person = await signIn(s, 'mcp-routes-person@example.com')
    const admin = await staffCookieFor(s, 'mcp-routes-boss@example.com', 'admin')
    const list = (cookie: string): Promise<Response> =>
      s.call('/api/auth/oauth2/get-clients', { headers: { cookie } })
    expect((await list(person)).status).toBeGreaterThanOrEqual(400)
    expect((await list(admin)).status).toBe(200)
    for (const cookie of [person, admin]) {
      const created = await s.call('/api/auth/oauth2/create-client', {
        method: 'POST',
        headers: { cookie, ...json },
        body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] })
      })
      expect(created.status).toBeGreaterThanOrEqual(400)
    }
    const registered = await s.call('/api/auth/oauth2/register', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'] })
    })
    expect(registered.status).toBeGreaterThanOrEqual(400)
  })

  it('answers the extra plugin endpoints only to a caller that proves who it is, and rate limits them', async () => {
    const s = setup()
    const form = { 'content-type': 'application/x-www-form-urlencoded' }
    const body = new URLSearchParams({ token: 'not-a-token', client_id: CLIENT_ID }).toString()
    for (const path of ['/api/auth/oauth2/introspect', '/api/auth/oauth2/revoke']) {
      const r = await s.call(path, { method: 'POST', headers: form, body })
      // Never a success for a stranger, and never a crash.
      expect([400, 401, 403, 404]).toContain(r.status)
    }
    const logout = await s.call(
      `/api/auth/oauth2/end-session?client_id=${encodeURIComponent(CLIENT_ID)}`
    )
    // Not offered at all: for an unknown app id it would make the Worker fetch that app's address.
    expect(logout.status).toBe(404)

    let introspectLimited = 0
    for (let i = 0; i < 24; i++) {
      const r = await s.call('/api/auth/oauth2/introspect', { method: 'POST', headers: form, body })
      if (r.status === 429) introspectLimited++
    }
    expect(introspectLimited).toBeGreaterThan(0)
  })

  /** An app's stored settings are kept between sign-ins, so a test that changes them removes them afterwards. */
  async function forgetClient(): Promise<void> {
    await bindings.DB.prepare('DELETE FROM oauth_client WHERE client_id = ?').bind(CLIENT_ID).run()
  }

  async function dpopKey(): Promise<{
    proof: (method: string, url: string, token?: string) => Promise<string>
  }> {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign'
    ])) as CryptoKeyPair
    const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey
    const enc = (value: unknown): string =>
      b64url(new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer)
    return {
      proof: async (method, url, token) => {
        const head = enc({
          typ: 'dpop+jwt',
          alg: 'ES256',
          jwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }
        })
        const body = enc({
          jti: crypto.randomUUID(),
          htm: method,
          htu: url,
          iat: Math.floor(Date.now() / 1000),
          ...(token
            ? {
                ath: b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
              }
            : {})
        })
        const sig = await crypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          new TextEncoder().encode(`${head}.${body}`)
        )
        return `${head}.${body}.${b64url(sig)}`
      }
    }
  }

  it('can bind a token to the app own key (DPoP), so a stolen token alone is useless', async () => {
    publishClient({ dpop_bound_access_tokens: true })
    const s = setup()
    const cookie = await signIn(s, 'mcp-dpop@example.com')
    const key = await dpopKey()
    const tokenUrl = `${ORIGIN}/api/auth/oauth2/token`
    const tokens = await getTokens(s, cookie, undefined, {
      dpop: await key.proof('POST', tokenUrl)
    })
    expect(String(tokens.token_type).toLowerCase()).toBe('dpop')

    const send = (headers: Record<string, string>): Promise<Response> =>
      s.call('/api/mcp', {
        method: 'POST',
        headers: {
          ...json,
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': '2026-07-28',
          'mcp-method': 'tools/list',
          ...headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
          params: {
            _meta: {
              'io.modelcontextprotocol/protocolVersion': '2026-07-28',
              'io.modelcontextprotocol/clientCapabilities': {}
            }
          }
        })
      })
    // Without the proof, the token is no good as a plain bearer token.
    expect((await send({ authorization: `Bearer ${tokens.access_token}` })).status).toBe(401)
    expect(
      (
        await send({
          authorization: `DPoP ${tokens.access_token}`,
          dpop: await key.proof('POST', RESOURCE, tokens.access_token)
        })
      ).status
    ).toBe(200)
    // A proof made with another key does not work.
    const thief = await dpopKey()
    expect(
      (
        await send({
          authorization: `DPoP ${tokens.access_token}`,
          dpop: await thief.proof('POST', RESOURCE, tokens.access_token)
        })
      ).status
    ).toBe(401)
    await forgetClient()
  })

  it('keeps only a hash of an app refresh token in the database', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-hash@example.com')
    const tokens = await getTokens(s, cookie, 'openid mcp:read offline_access')
    expect(tokens.refresh_token).toBeTruthy()
    const rows = (
      await bindings.DB.prepare('SELECT token FROM oauth_refresh_token').all<{
        token: string
      }>()
    ).results.map((r) => r.token)
    expect(rows.length).toBeGreaterThan(0)
    // A leaked database must not hand out working refresh tokens.
    expect(rows).not.toContain(tokens.refresh_token)
    await forgetClient()
  })

  it('offers the sign-out tool only to an app that was given the write permission', async () => {
    publishClient()
    const s = setup()
    const cookie = await signIn(s, 'mcp-write@example.com')
    const readOnly = await getTokens(s, cookie, 'openid mcp:read')
    expect(await (await call(s, readOnly.access_token, 'tools/list')).text()).not.toContain(
      'sign_out_device'
    )
    // Asking for it anyway is a step-up challenge (RFC 6750), so the app can ask the person to approve again.
    const denied = await call(s, readOnly.access_token, 'tools/call', {
      name: 'sign_out_device',
      arguments: { id: 'x' }
    })
    expect(denied.status).toBe(403)
    expect(denied.headers.get('www-authenticate')).toMatch(
      /error="insufficient_scope".*scope="mcp:write"/
    )
    const full = await getTokens(s, cookie, 'openid mcp:read mcp:write')
    expect(await (await call(s, full.access_token, 'tools/list')).text()).toContain(
      'sign_out_device'
    )

    await signIn(s, 'mcp-write-other@example.com')
    const otherRow = await bindings.DB.prepare(
      'SELECT s.id FROM session s JOIN user u ON u.id = s.user_id WHERE u.email = ?'
    )
      .bind('mcp-write-other@example.com')
      .first<{ id: string }>()
    const sessionsOf = async (): Promise<string[]> =>
      (
        await bindings.DB.prepare(
          'SELECT s.id FROM session s JOIN user u ON u.id = s.user_id WHERE u.email = ?'
        )
          .bind('mcp-write@example.com')
          .all<{ id: string }>()
      ).results.map((r) => r.id)
    const mine = await sessionsOf()
    expect(mine.length).toBeGreaterThan(0)
    const target = mine[0]!
    const signOut = (id: string): Promise<Response> =>
      call(s, full.access_token, 'tools/call', { name: 'sign_out_device', arguments: { id } })
    // Someone else's device: nothing happens.
    expect(await (await signOut(otherRow!.id)).text()).toContain('false')
    const still = await bindings.DB.prepare('SELECT id FROM session WHERE id = ?')
      .bind(otherRow!.id)
      .first()
    expect(still).not.toBeNull()
    // Your own: it is gone.
    expect(await (await signOut(target)).text()).toContain('true')
    expect(await sessionsOf()).not.toContain(target)
  })

  it('signs in an app without a browser with a code typed on the site', async () => {
    publishClient({
      grant_types: [
        'authorization_code',
        'urn:ietf:params:oauth:grant-type:device_code',
        'refresh_token'
      ]
    })
    const s = setup()
    const started = await s.call('/api/auth/device/code', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ client_id: CLIENT_ID, scope: 'openid mcp:read', resource: RESOURCE })
    })
    expect(started.status).toBe(200)
    const code = (await started.json()) as {
      device_code: string
      user_code: string
      verification_uri: string
    }
    expect(new URL(code.verification_uri).pathname).toBe('/device')

    // Nobody can approve it without signing in.
    const anonymous = await s.call('/api/auth/device/approve', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ userCode: code.user_code })
    })
    expect(anonymous.status).toBeGreaterThanOrEqual(400)

    const cookie = await signIn(s, 'mcp-device@example.com')
    const seen = await s.call(`/api/auth/device?user_code=${code.user_code}`, {
      headers: { cookie }
    })
    expect(await seen.json()).toMatchObject({ client_id: CLIENT_ID, status: 'pending' })
    const approved = await s.call('/api/auth/device/approve', {
      method: 'POST',
      headers: { cookie, ...json },
      body: JSON.stringify({ userCode: code.user_code })
    })
    expect(approved.status).toBe(200)

    const token = await s.call('/api/auth/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: code.device_code,
        client_id: CLIENT_ID,
        resource: RESOURCE
      }).toString()
    })
    expect(token.status).toBe(200)
    const { access_token } = (await token.json()) as { access_token: string }
    expect((await call(s, access_token, 'tools/list')).status).toBe(200)
    await forgetClient()
  })

  it('limits the endpoints that fetch an app address, on the paths Better Auth really uses', async () => {
    const s = setup()
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`
    const hit = async (path: string): Promise<number> =>
      (
        await s.call(path, {
          method: 'POST',
          headers: { ...json, 'x-forwarded-for': ip },
          body: '{}'
        })
      ).status
    for (const [path, max] of [
      ['/api/auth/device/code', 10],
      ['/api/auth/oauth2/token', 20]
    ] as const) {
      let last = 0
      for (let i = 0; i < max + 2; i++) last = await hit(path)
      expect(last, path).toBe(429)
    }
  })

  it('keeps app approvals through a time-limited suspension, and removes them for a permanent one', async () => {
    publishClient()
    const s = setup()
    await signIn(s, 'mcp-timed-boss@example.com')
    await bindings.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?")
      .bind('mcp-timed-boss@example.com')
      .run()
    const staffCookie = await signIn(s, 'mcp-timed-boss@example.com')
    const consents = async (email: string): Promise<number> =>
      (await bindings.DB.prepare(
        'SELECT COUNT(*) AS n FROM oauth_consent c JOIN user u ON u.id = c.user_id WHERE u.email = ?'
      )
        .bind(email)
        .first<{ n: number }>())!.n
    for (const [email, banExpiresIn, expected] of [
      ['mcp-timed@example.com', 3600, 1],
      ['mcp-forever@example.com', undefined, 0]
    ] as const) {
      const cookie = await signIn(s, email)
      await getTokens(s, cookie)
      const row = await bindings.DB.prepare('SELECT id FROM user WHERE email = ?')
        .bind(email)
        .first<{ id: string }>()
      const ban = await s.call('/api/auth/admin/ban-user', {
        method: 'POST',
        headers: { cookie: staffCookie, ...json },
        body: JSON.stringify({ userId: row!.id, banExpiresIn })
      })
      expect(ban.status).toBe(200)
      expect(await consents(email), email).toBe(expected)
    }
  })

  it('does not let people create or list clients by hand, or register one', async () => {
    const s = setup()
    const cookie = await signIn(s, 'mcp-clients@example.com')
    for (const [path, method] of [
      ['/api/auth/oauth2/create-client', 'POST'],
      ['/api/auth/oauth2/register', 'POST'],
      ['/api/auth/oauth2/get-clients', 'GET']
    ] as const) {
      const r = await s.call(path, {
        method,
        headers: { cookie, ...json },
        body: method === 'POST' ? JSON.stringify({ redirect_uris: [REDIRECT] }) : undefined
      })
      expect(r.status, path).toBeGreaterThanOrEqual(400)
    }
  })

  it('refuses an app whose address is not a public https page', async () => {
    const s = setup()
    const cookie = await signIn(s, 'mcp-bad@example.com')
    const query = new URLSearchParams({
      client_id: 'http://127.0.0.1/client.json',
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'openid mcp:read',
      code_challenge: 'x'.repeat(43),
      code_challenge_method: 'S256',
      resource: RESOURCE
    })
    const r = await s.call(`/api/auth/oauth2/authorize?${query}`, { headers: { cookie } })
    expect(new URL(r.headers.get('location') ?? ORIGIN, ORIGIN).searchParams.get('code')).toBeNull()
    expect(r.status === 302 ? (r.headers.get('location') ?? '') : '').not.toContain('/consent')
  })
})
