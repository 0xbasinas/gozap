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
