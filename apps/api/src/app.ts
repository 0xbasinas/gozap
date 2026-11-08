import { zValidator } from '@hono/zod-validator'
import * as Sentry from '@sentry/cloudflare'
import {
  clampUpdatedAt,
  deleteAccountInputSchema,
  emptyPreferences,
  newerWins,
  parsePreferences,
  preferencesRecordSchema,
  type PreferencesRecord,
  type Account,
  type AccountExport
} from '@repo/shared'
import { eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { createAuth, type Auth } from './auth'
import { createDb, schema, type Db } from './db'
import { createConsoleSender, createResendSender, type EmailSender } from './email'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'
import { Resend } from 'resend'
import { suppress, suppressionsFrom } from './suppression'

type Variables = { auth: Auth; db: Db; userId: string }
type AppEnv = { Bindings: Bindings; Variables: Variables }

export interface AppOptions {
  /** Replace how emails are sent (tests). By default: Resend when a key is set, otherwise the log. */
  emailSender?: (env: Bindings) => EmailSender
}

const defaultEmailSender = (env: Bindings): EmailSender =>
  env.RESEND_API_KEY
    ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : createConsoleSender()

/**
 * Requires a signed-in user. `fresh` skips the 5-minute session cookie cache and asks the database, which account
 * actions need: a deleted account or a revoked session must stop working at once, not five minutes later.
 */
const requireSession =
  (fresh: boolean): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const session = await c.var.auth.api.getSession({
      headers: c.req.raw.headers,
      query: fresh ? { disableCookieCache: true } : undefined
    })
    if (!session) throw new HTTPException(401, { message: 'Sign in first' })
    c.set('userId', session.user.id)
    await next()
  }

const toAccount = (row: typeof schema.user.$inferSelect): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt.toISOString()
})

async function readPreferences(db: Db, userId: string): Promise<PreferencesRecord> {
  const [row] = await db
    .select()
    .from(schema.preference)
    .where(eq(schema.preference.userId, userId))
  if (!row) return emptyPreferences()
  let raw: unknown = null
  try {
    raw = JSON.parse(row.data)
  } catch {
    // unreadable data falls back to the defaults
  }
  return { preferences: parsePreferences(raw), updatedAt: row.updatedAt }
}

export function createApp(options: AppOptions = {}) {
  const sender = options.emailSender ?? defaultEmailSender

  // Preferences that follow the person between the web app and the desktop app. Last write wins.
  const preferences = new Hono<AppEnv>()
    .use(sameOriginOnly)
    .use(requireSession(false))
    .get('/', async (c) => c.json(await readPreferences(c.var.db, c.var.userId)))
    .put('/', zValidator('json', preferencesRecordSchema), async (c) => {
      const incoming = c.req.valid('json')
      const current = await readPreferences(c.var.db, c.var.userId)
      // An app from before the accent colour existed sends only the theme, and the schema would fill in the default
      // accent. Keep the stored one instead, so an older device cannot reset it.
      const sent = ((await c.req.json()) as { preferences?: Record<string, unknown> }).preferences
      const record: PreferencesRecord = {
        preferences: {
          ...incoming.preferences,
          accent:
            sent && 'accent' in sent ? incoming.preferences.accent : current.preferences.accent
        },
        updatedAt: clampUpdatedAt(incoming.updatedAt, Date.now())
      }
      const winner = newerWins(record, current)
      // Only write when the incoming copy is actually newer: a stale device then costs a read, not a write.
      if (winner === record && record.updatedAt > current.updatedAt) {
        const data = JSON.stringify(record.preferences)
        await c.var.db
          .insert(schema.preference)
          .values({ userId: c.var.userId, data, updatedAt: record.updatedAt })
          .onConflictDoUpdate({
            target: schema.preference.userId,
            set: { data, updatedAt: record.updatedAt }
          })
        return c.json(record)
      }
      return c.json(current)
    })

  // The person's own account: see it, download everything we hold, delete it.
  const account = new Hono<AppEnv>()
    .use(sameOriginOnly)
    .use(requireSession(true))
    .get('/', async (c) => {
      const [row] = await c.var.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, c.var.userId))
      if (!row) throw new HTTPException(404, { message: 'Not found' })
      return c.json(toAccount(row))
    })
    .get('/export', async (c) => {
      const [row] = await c.var.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, c.var.userId))
      if (!row) throw new HTTPException(404, { message: 'Not found' })
      // Only what the person can see on their account page; the public keys are not personal data.
      const passkeyRows = await c.var.db
        .select({
          name: schema.passkey.name,
          deviceType: schema.passkey.deviceType,
          createdAt: schema.passkey.createdAt
        })
        .from(schema.passkey)
        .where(eq(schema.passkey.userId, c.var.userId))
      // Session rows are listed without their tokens.
      const sessionRows = await c.var.db
        .select({
          createdAt: schema.session.createdAt,
          expiresAt: schema.session.expiresAt,
          ipAddress: schema.session.ipAddress,
          userAgent: schema.session.userAgent
        })
        .from(schema.session)
        .where(eq(schema.session.userId, c.var.userId))
      const body: AccountExport = {
        exportedAt: new Date().toISOString(),
        account: toAccount(row),
        preferences: await readPreferences(c.var.db, c.var.userId),
        passkeys: passkeyRows.map((p) => ({
          name: p.name,
          deviceType: p.deviceType,
          createdAt: p.createdAt?.toISOString() ?? null
        })),
        sessions: sessionRows.map((s) => ({
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ipAddress: s.ipAddress,
          userAgent: s.userAgent
        }))
      }
      c.header('content-disposition', 'attachment; filename="my-data.json"')
      c.header('cache-control', 'no-store')
      return c.json(body)
    })
    .delete('/', zValidator('json', deleteAccountInputSchema), async (c) => {
      const { confirmEmail } = c.req.valid('json')
      const [row] = await c.var.db
        .select()
        .from(schema.user)
        .where(eq(schema.user.id, c.var.userId))
      if (!row) throw new HTTPException(404, { message: 'Not found' })
      if (row.email.toLowerCase() !== confirmEmail) {
        throw new HTTPException(400, { message: 'The email does not match this account' })
      }
      // Sign out first so the response carries the headers that clear the session cookies.
      const signedOut = await c.var.auth.api.signOut({
        headers: c.req.raw.headers,
        asResponse: true
      })
      // Sessions, linked accounts, passkeys and preferences go with the user (ON DELETE CASCADE). Unused sign-in links are removed too.
      await c.var.db.batch([
        c.var.db.delete(schema.verification).where(eq(schema.verification.identifier, row.email)),
        c.var.db.delete(schema.user).where(eq(schema.user.id, c.var.userId))
      ])
      const response = c.body(null, 204)
      for (const cookie of signedOut.headers.getSetCookie())
        response.headers.append('set-cookie', cookie)
      return response
    })

  return (
    new Hono<AppEnv>()
      .basePath('/api')
      .use(secureHeaders())
      .use(async (c, next) => {
        const db = createDb(c.env.DB)
        c.set('db', db)
        c.set(
          'auth',
          createAuth({
            db,
            env: c.env,
            email: sender(c.env),
            waitUntil: (p) => c.executionCtx.waitUntil(p)
          })
        )
        await next()
      })
      .get('/health', (c) => c.json({ ok: true }))
      // Sign-in, sessions and sign-out: handled by Better Auth under /api/auth/*.
      .on(['GET', 'POST'], '/auth/*', (c) => c.var.auth.handler(c.req.raw))
      // Resend tells us about bounces and spam complaints. Signed (Svix), so only Resend can call it; off without the secret.
      .post('/webhooks/resend', async (c) => {
        const secret = c.env.RESEND_WEBHOOK_SECRET
        if (!secret) throw new HTTPException(404, { message: 'Not found' })
        const payload = await c.req.text()
        let event: unknown
        try {
          event = new Resend('re_unused').webhooks.verify({
            payload,
            headers: {
              id: c.req.header('svix-id') ?? '',
              timestamp: c.req.header('svix-timestamp') ?? '',
              signature: c.req.header('svix-signature') ?? ''
            },
            webhookSecret: secret
          })
        } catch {
          throw new HTTPException(400, { message: 'Invalid webhook' })
        }
        const items = suppressionsFrom(event)
        if (items.length > 0) {
          await suppress(c.var.db, items)
          if (items.some((i) => i.reason === 'complained')) {
            Sentry.captureMessage('A recipient marked a sign-in email as spam', 'warning')
          }
        }
        return c.json({ ok: true })
      })
      .route('/preferences', preferences)
      .route('/account', account)
      .onError((error, c) => {
        if (error instanceof HTTPException) return c.json({ error: error.message }, error.status)
        console.error('Unhandled error', error)
        Sentry.captureException(error)
        return c.json({ error: 'Something went wrong' }, 500)
      })
      .notFound((c) => c.json({ error: 'Not found' }, 404))
  )
}

export type AppType = ReturnType<typeof createApp>
