import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { createDb } from '../src/db'
import { deleteDueAccounts } from '../src/deletion'
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
  const app = createApp({ emailSender: () => ({ send: async (m) => void sent.push(m) }) })
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
async function signIn(s: ReturnType<typeof setup>, email: string): Promise<string> {
  const before = s.sent.length
  const request = await s.call('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, callbackURL: '/app' })
  })
  expect(request.status).toBe(200)
  expect(s.sent.length).toBe(before + 1)
  const message = s.sent[before]!
  expect(message.to).toBe(email)
  const link = /https?:\/\/\S+magic-link\/verify\S+/.exec(message.text)?.[0]
  expect(link).toBeTruthy()

  const verify = await s.call(new URL(link!).pathname + new URL(link!).search)
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
