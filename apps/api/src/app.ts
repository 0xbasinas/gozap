import { zValidator } from '@hono/zod-validator'
import * as Sentry from '@sentry/cloudflare'
import {
  cancelDeletionInputSchema,
  clampUpdatedAt,
  describeDevice,
  renameDeviceInputSchema,
  type Device,
  deleteAccountInputSchema,
  emptyPreferences,
  FEEDBACK_PER_HOUR,
  feedbackInputSchema,
  newerWins,
  parsePreferences,
  preferencesRecordSchema,
  type PreferencesRecord,
  type Account,
  type AccountExport
} from '@repo/shared'
import { and, count, eq, gt, ne } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { createAuth, DEFAULT_APP_NAME, type Auth } from './auth'
import {
  cancelDeletion,
  cancelDeletionWithToken,
  deletionEmail,
  requestDeletion,
  scheduledDeletion
} from './deletion'
import { createDb, schema, type Db } from './db'
import { createConsoleSender, createResendSender, type EmailSender } from './email'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'
import { Resend } from 'resend'
import { suppress, suppressionsFrom } from './suppression'

type Variables = { auth: Auth; db: Db; userId: string; sessionId: string }
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
    c.set('sessionId', session.session.id)
    await next()
  }

const toAccount = (
  row: typeof schema.user.$inferSelect,
  deletionScheduledFor: number | null
): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  deletionScheduledFor:
    deletionScheduledFor === null ? null : new Date(deletionScheduledFor).toISOString()
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

  // Where the person is signed in: one entry per session, with an optional name. Every query is limited to their own sessions.
  const devices = new Hono<AppEnv>()
    .use(sameOriginOnly)
    // Fresh: a session signed out from another device must stop counting at once, not after the 5-minute cookie cache.
    .use(requireSession(true))
    .get('/', async (c) => {
      const rows = await c.var.db
        .select({
          id: schema.session.id,
          userAgent: schema.session.userAgent,
          createdAt: schema.session.createdAt,
          updatedAt: schema.session.updatedAt,
          nickname: schema.sessionNickname.nickname
        })
        .from(schema.session)
        .leftJoin(schema.sessionNickname, eq(schema.sessionNickname.sessionId, schema.session.id))
        .where(eq(schema.session.userId, c.var.userId))
      const list: Device[] = rows
        .map((r) => ({
          id: r.id,
          label: describeDevice(r.userAgent),
          nickname: r.nickname,
          createdAt: r.createdAt.toISOString(),
          lastSeenAt: r.updatedAt.toISOString(),
          current: r.id === c.var.sessionId
        }))
        // This device first, then the most recently used.
        .sort(
          (a, b) =>
            Number(b.current) - Number(a.current) || b.lastSeenAt.localeCompare(a.lastSeenAt)
        )
      c.header('cache-control', 'no-store')
      return c.json(list)
    })
    .patch('/:id', zValidator('json', renameDeviceInputSchema), async (c) => {
      const { nickname } = c.req.valid('json')
      const [own] = await c.var.db
        .select({ id: schema.session.id })
        .from(schema.session)
        .where(
          and(eq(schema.session.id, c.req.param('id')), eq(schema.session.userId, c.var.userId))
        )
      if (!own) throw new HTTPException(404, { message: 'Not found' })
      if (!nickname) {
        await c.var.db
          .delete(schema.sessionNickname)
          .where(eq(schema.sessionNickname.sessionId, own.id))
      } else {
        await c.var.db
          .insert(schema.sessionNickname)
          .values({ sessionId: own.id, userId: c.var.userId, nickname, updatedAt: Date.now() })
          .onConflictDoUpdate({
            target: schema.sessionNickname.sessionId,
            set: { nickname, updatedAt: Date.now() }
          })
      }
      return c.body(null, 204)
    })
    .delete('/:id', async (c) => {
      const id = c.req.param('id')
      if (id === c.var.sessionId) {
        throw new HTTPException(400, {
          message: 'This is the device you are using. Use Sign out instead.'
        })
      }
      const removed = await c.var.db
        .delete(schema.session)
        .where(
          and(
            eq(schema.session.id, id),
            eq(schema.session.userId, c.var.userId),
            ne(schema.session.id, c.var.sessionId)
          )
        )
        .returning({ id: schema.session.id })
      if (removed.length === 0) throw new HTTPException(404, { message: 'Not found' })
      return c.body(null, 204)
    })

  // Feedback from the web app and the desktop app. Needs a session (so there is no anonymous spam) and is limited per person.
  const feedback = new Hono<AppEnv>()
    .use(sameOriginOnly)
    .use(requireSession(false))
    .post('/', zValidator('json', feedbackInputSchema), async (c) => {
      const input = c.req.valid('json')
      const now = Date.now()
      // One indexed count (user_id, created_at): cheap, and enough to stop a loop or a flood.
      const [recent] = await c.var.db
        .select({ n: count() })
        .from(schema.feedback)
        .where(
          and(
            eq(schema.feedback.userId, c.var.userId),
            gt(schema.feedback.createdAt, now - 3_600_000)
          )
        )
      if ((recent?.n ?? 0) >= FEEDBACK_PER_HOUR) {
        throw new HTTPException(429, {
          message: 'You have sent a lot of feedback. Try again in an hour.'
        })
      }
      const id = crypto.randomUUID()
      await c.var.db.insert(schema.feedback).values({
        id,
        userId: c.var.userId,
        kind: input.kind,
        message: input.message,
        diagnostics: input.diagnostics ?? null,
        appVersion: input.appVersion ?? null,
        platform: input.platform ?? null,
        source: input.source,
        createdAt: now
      })
      return c.json({ id }, 201)
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
      return c.json(toAccount(row, await scheduledDeletion(c.var.db, c.var.userId)))
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
      const feedbackRows = await c.var.db
        .select({
          kind: schema.feedback.kind,
          message: schema.feedback.message,
          source: schema.feedback.source,
          diagnostics: schema.feedback.diagnostics,
          createdAt: schema.feedback.createdAt
        })
        .from(schema.feedback)
        .where(eq(schema.feedback.userId, c.var.userId))
      // Session rows are listed without their tokens.
      const sessionRows = await c.var.db
        .select({
          createdAt: schema.session.createdAt,
          expiresAt: schema.session.expiresAt,
          ipAddress: schema.session.ipAddress,
          userAgent: schema.session.userAgent,
          nickname: schema.sessionNickname.nickname
        })
        .from(schema.session)
        .leftJoin(schema.sessionNickname, eq(schema.sessionNickname.sessionId, schema.session.id))
        .where(eq(schema.session.userId, c.var.userId))
      const body: AccountExport = {
        exportedAt: new Date().toISOString(),
        account: toAccount(row, await scheduledDeletion(c.var.db, c.var.userId)),
        preferences: await readPreferences(c.var.db, c.var.userId),
        passkeys: passkeyRows.map((p) => ({
          name: p.name,
          deviceType: p.deviceType,
          createdAt: p.createdAt?.toISOString() ?? null
        })),
        feedback: feedbackRows.map((r) => ({
          kind: r.kind as 'bug' | 'idea' | 'other',
          message: r.message,
          source: r.source,
          hasDiagnostics: r.diagnostics !== null,
          createdAt: new Date(r.createdAt).toISOString()
        })),
        sessions: sessionRows.map((s) => ({
          createdAt: s.createdAt.toISOString(),
          expiresAt: s.expiresAt.toISOString(),
          ipAddress: s.ipAddress,
          userAgent: s.userAgent,
          nickname: s.nickname
        }))
      }
      c.header('content-disposition', 'attachment; filename="my-data.json"')
      c.header('cache-control', 'no-store')
      return c.json(body)
    })
    // Asking to delete does not delete: the account stays for the cooling-off period, and the person gets an email
    // with a link to change their mind (the daily job in index.ts removes accounts whose time has come).
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
      const request = await requestDeletion(c.var.db, c.var.userId, Date.now())
      if (request.token) {
        const cancelUrl = new URL('/account/cancel-deletion', c.env.BETTER_AUTH_URL)
        cancelUrl.searchParams.set('token', request.token)
        const message = deletionEmail(
          c.env.APP_NAME || DEFAULT_APP_NAME,
          request.scheduledFor,
          cancelUrl.href
        )
        // Not awaited, and a failure is only logged: the request itself is saved, and the account page shows the date.
        c.executionCtx.waitUntil(
          sender(c.env)
            .send({ to: row.email, ...message })
            .catch((error: unknown) => {
              console.error('Could not send the deletion email', error)
              Sentry.captureException(error)
            })
        )
      }
      return c.json({ scheduledFor: new Date(request.scheduledFor).toISOString() }, 202)
    })
    .post('/deletion/cancel', async (c) => {
      await cancelDeletion(c.var.db, c.var.userId)
      return c.body(null, 204)
    })

  // Cancelling from the email link needs no sign-in (the person may be signed out). The link opens a page that
  // sends the token here with a POST, so an email scanner that only opens links cannot cancel by accident.
  const cancelByToken = new Hono<AppEnv>()
    .use(sameOriginOnly)
    .post('/', zValidator('json', cancelDeletionInputSchema), async (c) => {
      const cancelled = await cancelDeletionWithToken(c.var.db, c.req.valid('json').token)
      if (!cancelled)
        throw new HTTPException(404, { message: 'This link has expired or was already used' })
      return c.body(null, 204)
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
      .route('/devices', devices)
      .route('/feedback', feedback)
      .route('/account/deletion/cancel-with-token', cancelByToken)
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
