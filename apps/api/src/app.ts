import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import * as Sentry from '@sentry/cloudflare'
import {
  cancelDeletionInputSchema,
  changeEmailInputSchema,
  clampUpdatedAt,
  confirmEmailChangeInputSchema,
  describeDevice,
  renameDeviceInputSchema,
  type Device,
  deleteAccountInputSchema,
  emptyPreferences,
  FEEDBACK_PER_HOUR,
  feedbackInputSchema,
  newerWins,
  flagsQuerySchema,
  setConsentInputSchema,
  parsePreferences,
  parseVersion,
  preferencesRecordSchema,
  type PreferencesRecord,
  type Account,
  type AccountExport
} from '@repo/shared'
import { and, count, eq, gt, inArray, ne } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { createMcpProtectedRequestHandler } from '@better-auth/mcp'
import { createDpopReplayStore } from 'better-auth/oauth2'
import { createAuth, DEFAULT_APP_NAME, MCP_READ_SCOPE, mcpResource, type Auth } from './auth'
import { handleMcp } from './mcpServer'
import { isAiAppDisabled, listAiApps, setAiAppDisabledStatements } from './aiApps'
import { cachedJwks } from './jwksCache'
import {
  cancelDeletion,
  cancelDeletionWithToken,
  deletionEmail,
  requestDeletion,
  scheduledDeletion
} from './deletion'
import { createDb, schema, type Db } from './db'
import {
  confirmEmailChange,
  confirmEmailMessage,
  emailChangedNotice,
  pendingEmail,
  requestEmailChange
} from './emailChange'
import { createConsoleSender, createResendSender, type EmailSender } from './email'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'
import { Resend } from 'resend'
import { evaluateFlags, loadRules } from './flags'
import { listConsents, recordConsent } from './consents'
import { listRequests, openRequest } from './dataRequests'
import { recentSignIns } from './signIns'
import { recentAudit, recordAudit } from './audit'
import { teamsOf } from './teams'
import { createPresenceApi, presenceOf } from './presence'
import { createTodosApi, todosOf } from './todos'
import { createWorkspaceApi } from './workspace'
import { createScimAdmin, createScimApi } from './scimRoutes'
import { DiscoveryError, discoverIssuer } from './ssoDiscovery'
import { isSuppressed, suppress, suppressionsFrom } from './suppression'

type Variables = { auth: Auth; db: Db; userId: string; sessionId: string }
type AppEnv = { Bindings: Bindings; Variables: Variables }

export interface AppOptions {
  /** How long one Worker instance keeps the flag table in memory. Tests use 0. */
  flagCacheMs?: number
  /** Replace how emails are sent (tests). By default: Resend when a key is set, otherwise the log. */
  emailSender?: (env: Bindings) => EmailSender
}

export const defaultEmailSender = (env: Bindings): EmailSender =>
  env.RESEND_API_KEY
    ? createResendSender(env.RESEND_API_KEY, env.EMAIL_FROM)
    : createConsoleSender()

/**
 * Requires a signed-in user. `fresh` skips the 1-minute session cookie cache and asks the database, which account
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
    // The session itself (cached or not) cannot know about a suspension: ask the database, by primary key.
    const [live] = await c.var.db
      .select({ banned: schema.user.banned, banExpires: schema.user.banExpires })
      .from(schema.session)
      .innerJoin(schema.user, eq(schema.user.id, schema.session.userId))
      .where(eq(schema.session.id, session.session.id))
    const suspended = live?.banned && (!live.banExpires || live.banExpires.getTime() > Date.now())
    if (!live || suspended) throw new HTTPException(401, { message: 'Sign in first' })
    // Staff who impersonate a person may look, not act as them: no changes, and no export of their data.
    const impersonating = (session.session as { impersonatedBy?: string | null }).impersonatedBy
    if (
      impersonating &&
      (!['GET', 'HEAD'].includes(c.req.method) || c.req.path.endsWith('/export'))
    )
      throw new HTTPException(403, { message: 'Not allowed while viewing as this person' })
    c.set('userId', session.user.id)
    c.set('sessionId', session.session.id)
    await next()
  }

/** Only the `admin` role (not `support`). Run after requireSession; reads the role from the database, not the cookie. */
const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const [me] = await c.var.db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, c.var.userId))
  if (me?.role !== 'admin') throw new HTTPException(403, { message: 'Not allowed' })
  await next()
}

const toAccount = (
  row: typeof schema.user.$inferSelect,
  deletionScheduledFor: number | null,
  pendingEmail: string | null
): Account => ({
  id: row.id,
  email: row.email,
  name: row.name,
  createdAt: row.createdAt.toISOString(),
  deletionScheduledFor:
    deletionScheduledFor === null ? null : new Date(deletionScheduledFor).toISOString(),
  pendingEmail
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
    // Fresh: a session signed out from another device must stop counting at once, not after the 1-minute cookie cache.
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
      return c.json(
        toAccount(
          row,
          await scheduledDeletion(c.var.db, c.var.userId),
          await pendingEmail(c.var.db, c.var.userId, Date.now())
        )
      )
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
      // Asking for the data is itself a request that is answered right away; log it so the page can show it.
      await openRequest(c.var.db, c.var.userId, 'export', 'done', Date.now())
      const body: AccountExport = {
        exportedAt: new Date().toISOString(),
        account: toAccount(
          row,
          await scheduledDeletion(c.var.db, c.var.userId),
          await pendingEmail(c.var.db, c.var.userId, Date.now())
        ),
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
        signInActivity: await recentSignIns(c.var.db, c.var.userId),
        securityActivity: await recentAudit(c.var.db, c.var.userId),
        teams: await teamsOf(c.var.db, c.var.userId),
        todos: await todosOf(c.var.db, c.var.userId),
        presence: await presenceOf(c.var.db, c.var.userId),
        // What a company directory (SCIM) says about this person, per team.
        directory: await c.var.db
          .select({
            team: schema.organization.name,
            userName: schema.scimUser.userName,
            externalId: schema.scimUser.externalId,
            active: schema.scimUser.active
          })
          .from(schema.scimUser)
          .innerJoin(
            schema.scimConnection,
            eq(schema.scimConnection.id, schema.scimUser.connectionId)
          )
          .innerJoin(
            schema.organization,
            eq(schema.organization.id, schema.scimConnection.organizationId)
          )
          .where(eq(schema.scimUser.userId, c.var.userId)),
        // AI apps this person approved (not the tokens).
        connectedApps: (
          await c.var.db
            .select({
              clientId: schema.oauthConsent.clientId,
              scopes: schema.oauthConsent.scopes,
              createdAt: schema.oauthConsent.createdAt
            })
            .from(schema.oauthConsent)
            .where(eq(schema.oauthConsent.userId, c.var.userId))
        ).map((r) => ({
          clientId: r.clientId,
          scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
          createdAt: r.createdAt.toISOString()
        })),
        // Never the key itself or its hash: only enough to recognise which key it was.
        apiKeys: (
          await c.var.db
            .select({
              name: schema.apikey.name,
              start: schema.apikey.start,
              createdAt: schema.apikey.createdAt,
              expiresAt: schema.apikey.expiresAt
            })
            .from(schema.apikey)
            .where(eq(schema.apikey.referenceId, c.var.userId))
        ).map((k) => ({
          name: k.name,
          start: k.start,
          createdAt: k.createdAt.toISOString(),
          expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null
        })),
        dataRequests: await listRequests(c.var.db, c.var.userId),
        consents: (await listConsents(c.var.db, c.var.userId)).history,
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
    // What we hold about the person, as counts (the data itself is in the export). The page shows it next to the export and delete buttons.
    .get('/privacy', async (c) => {
      const userId = c.var.userId
      const countOf = async (
        table:
          | typeof schema.session
          | typeof schema.signInEvent
          | typeof schema.auditEvent
          | typeof schema.passkey
          | typeof schema.feedback
      ): Promise<number> => {
        const [row] = await c.var.db
          .select({ n: count() })
          .from(table)
          .where(eq(table.userId, userId))
        return row?.n ?? 0
      }
      const [prefs] = await c.var.db
        .select({ userId: schema.preference.userId })
        .from(schema.preference)
        .where(eq(schema.preference.userId, userId))
      return c.json({
        devices: await countOf(schema.session),
        signIns: await countOf(schema.signInEvent),
        securityEvents: await countOf(schema.auditEvent),
        passkeys: await countOf(schema.passkey),
        feedback: await countOf(schema.feedback),
        hasSyncedSettings: prefs !== undefined
      })
    })
    .get('/security-activity', async (c) => c.json(await recentAudit(c.var.db, c.var.userId)))
    .get('/consents', async (c) => c.json(await listConsents(c.var.db, c.var.userId)))
    .post('/consents', zValidator('json', setConsentInputSchema), async (c) => {
      const { purpose, granted } = c.req.valid('json')
      await recordConsent(c.var.db, c.var.userId, purpose, granted, Date.now())
      return c.json(await listConsents(c.var.db, c.var.userId))
    })
    .get('/requests', async (c) => c.json(await listRequests(c.var.db, c.var.userId)))
    .get('/sign-ins', async (c) => c.json(await recentSignIns(c.var.db, c.var.userId)))
    // Moving to a new address: a link goes to the NEW address and nothing changes until it is used. The answer is the
    // same whether or not the address is already taken, so this cannot be used to find out who has an account.
    .post('/email-change', zValidator('json', changeEmailInputSchema), async (c) => {
      const { newEmail } = c.req.valid('json')
      const [row] = await c.var.db
        .select({ email: schema.user.email })
        .from(schema.user)
        .where(eq(schema.user.id, c.var.userId))
      if (!row) throw new HTTPException(404, { message: 'Not found' })
      if (row.email.toLowerCase() === newEmail) {
        throw new HTTPException(400, { message: 'That is already your email address' })
      }
      const request = await requestEmailChange(c.var.db, c.var.userId, newEmail, Date.now())
      if (request.status === 'too-soon') {
        throw new HTTPException(429, { message: 'Wait a minute before asking again' })
      }
      if (request.status === 'sent' && !(await isSuppressed(c.var.db, newEmail))) {
        const url = new URL('/account/confirm-email', c.env.BETTER_AUTH_URL)
        url.searchParams.set('token', request.token)
        const message = confirmEmailMessage(c.env.APP_NAME || DEFAULT_APP_NAME, url.href)
        c.executionCtx.waitUntil(
          sender(c.env)
            .send({ to: newEmail, ...message })
            .catch((error: unknown) => {
              console.error('Could not send the email-change link', error)
              Sentry.captureException(error)
            })
        )
      }
      return c.body(null, 202)
    })

  // The link in the email opens a page that sends the token here with a POST (an email scanner that only opens links
  // cannot confirm by accident). No sign-in is needed: the person may open it on another device.
  const confirmEmail = new Hono<AppEnv>()
    .use(sameOriginOnly)
    .post('/', zValidator('json', confirmEmailChangeInputSchema), async (c) => {
      const changed = await confirmEmailChange(c.var.db, c.req.valid('json').token, Date.now())
      if (!changed)
        throw new HTTPException(404, { message: 'This link has expired or was already used' })
      c.executionCtx.waitUntil(
        recordAudit(c.var.db, {
          type: 'email_changed',
          outcome: 'success',
          userId: changed.userId,
          ipAddress: c.req.header('cf-connecting-ip') ?? null,
          userAgent: c.req.header('user-agent') ?? null,
          now: Date.now()
        }).catch((error: unknown) => console.error('Could not record the audit event', error))
      )
      // Tell the old address, so a takeover does not go unnoticed.
      c.executionCtx.waitUntil(
        sender(c.env)
          .send({
            to: changed.oldEmail,
            ...emailChangedNotice(c.env.APP_NAME || DEFAULT_APP_NAME, changed.newEmail)
          })
          .catch((error: unknown) => console.error('Could not send the notice', error))
      )
      return c.json({ email: changed.newEmail })
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
        // Built on first use: health checks, SCIM and preferences never touch it, and it is the heavy part.
        let auth: Auth | undefined
        const make = (): Auth =>
          (auth ??= createAuth({
            db,
            env: c.env,
            email: sender(c.env),
            waitUntil: (p) => c.executionCtx.waitUntil(p)
          }))
        c.set(
          'auth',
          new Proxy({} as Auth, {
            get: (_target, property) => Reflect.get(make(), property)
          })
        )
        await next()
      })
      .get('/health', (c) => c.json({ ok: true }))
      // Staff: one person's security activity. Needs the same permission as looking the person up.
      .get('/admin/audit/:userId', requireSession(true), async (c) => {
        const allowed = await c.var.auth.api.userHasPermission({
          body: { userId: c.var.userId, permissions: { user: ['get'] } }
        })
        if (!allowed.success) throw new HTTPException(403, { message: 'Not allowed' })
        return c.json(await recentAudit(c.var.db, c.req.param('userId')))
      })
      // Staff (admin role only): the AI apps that have asked for access, and a switch to turn one off or on. Better Auth's
      // own update-client route cannot set `disabled` from outside the server, so this is ours.
      .get('/admin/ai-apps', requireSession(true), requireAdmin, async (c) =>
        c.json(await listAiApps(c.var.db))
      )
      .post('/admin/ai-apps/:action', requireSession(true), requireAdmin, async (c) => {
        const action = c.req.param('action')
        if (action !== 'disable' && action !== 'enable')
          throw new HTTPException(404, { message: 'Not found' })
        const body = z
          .object({ clientId: z.string().min(1).max(2048) })
          .safeParse(await c.req.json().catch(() => null))
        if (!body.success) throw new HTTPException(400, { message: 'Choose an app' })
        const disabling = action === 'disable'
        const [known] = await c.var.db
          .select({ id: schema.oauthClient.id })
          .from(schema.oauthClient)
          .where(eq(schema.oauthClient.clientId, body.data.clientId))
        if (!known) throw new HTTPException(404, { message: 'No such app' })
        await c.var.db.batch(setAiAppDisabledStatements(c.var.db, body.data.clientId, disabling))
        c.executionCtx.waitUntil(
          recordAudit(c.var.db, {
            type: disabling ? 'ai_app_disabled' : 'ai_app_enabled',
            outcome: 'success',
            // Kept under the staff member's own id: events about nobody are pruned after 30 days.
            userId: c.var.userId,
            actorId: c.var.userId,
            ipAddress: c.req.header('cf-connecting-ip') ?? null,
            userAgent: c.req.header('user-agent') ?? null,
            subject: body.data.clientId.slice(0, 200),
            now: Date.now()
          }).catch((error: unknown) => console.error('Could not record the app change', error))
        )
        return c.json({ ok: true })
      })
      // The simplest call a script can make with an API key (header x-api-key): who owns this key.
      .get('/v1/me', async (c) => {
        const key = c.req.header('x-api-key')
        const checked = key
          ? await c.var.auth.api.verifyApiKey({
              body: { key, permissions: { account: ['read'] } }
            })
          : null
        if (!checked?.valid || !checked.key)
          throw new HTTPException(401, { message: 'Invalid key' })
        const [owner] = await c.var.db
          .select({ id: schema.user.id, email: schema.user.email, banned: schema.user.banned })
          .from(schema.user)
          .where(eq(schema.user.id, checked.key.referenceId))
        if (!owner || owner.banned) throw new HTTPException(401, { message: 'Invalid key' })
        return c.json({ id: owner.id, email: owner.email })
      })
      // AI apps (Model Context Protocol) call this with an access token that a person approved. The token is checked
      // against our signing keys (no database read), then the person is looked up so a suspension takes effect at once.
      .all('/mcp', async (c) => {
        const { baseURL, internalAdapter } = await c.var.auth.$context
        const guarded = createMcpProtectedRequestHandler(
          {
            issuer: baseURL,
            audience: mcpResource(c.env.BETTER_AUTH_URL),
            jwtVerifyOptions: { requiredClaims: ['azp'] },
            requiredScopes: [MCP_READ_SCOPE],
            // Our own signing keys, read in-process: a Worker should not call its own address to fetch them.
            jwksUrl: (() => cachedJwks(() => c.var.auth.api.getJwks())) as unknown as string,
            dpop: { replayStore: createDpopReplayStore(internalAdapter) }
          },
          async (request, claims) => {
            const [owner] = await c.var.db
              .select({ banned: schema.user.banned, banExpires: schema.user.banExpires })
              .from(schema.user)
              .where(eq(schema.user.id, String(claims.sub)))
            const suspended =
              owner?.banned && (!owner.banExpires || owner.banExpires.getTime() > Date.now())
            if (!owner || suspended)
              return Response.json({ error: 'invalid_token' }, { status: 401 })
            // Staff can switch an app off; its tokens stop working at once, not when they expire.
            if (await isAiAppDisabled(c.var.db, String(claims.azp)))
              return Response.json({ error: 'invalid_token' }, { status: 401 })
            return handleMcp(
              request,
              c.var.db,
              String(claims.sub),
              c.env.APP_NAME || DEFAULT_APP_NAME,
              String(claims.scope ?? '')
                .split(' ')
                .filter(Boolean),
              new URL('/.well-known/oauth-protected-resource/api/mcp', c.env.BETTER_AUTH_URL).href
            )
          }
        )
        return guarded(c.req.raw)
      })
      // OAuth discovery documents live at the site root (/.well-known/...), outside /api. index.ts sends them here,
      // and Better Auth answers from the original path.
      .on(['GET', 'HEAD'], '/__discovery/*', (c) => {
        const url = new URL(c.req.url)
        url.pathname = url.pathname.slice('/api/__discovery'.length)
        return c.var.auth.handler(new Request(url, c.req.raw))
      })
      // Sign-in, sessions and sign-out: handled by Better Auth under /api/auth/*.
      .on(['GET', 'POST'], '/auth/*', async (c) => {
        const response = await c.var.auth.handler(c.req.raw)
        // A suspended person who opens a sign-in link gets JSON from Better Auth. A browser should see a page instead.
        if (response.status === 403 && new URL(c.req.url).pathname.endsWith('/magic-link/verify')) {
          const body = (await response
            .clone()
            .json()
            .catch(() => null)) as { code?: string } | null
          if (body?.code === 'BANNED_USER') {
            const target = new URL('/sign-in?error=suspended', c.req.url)
            return c.redirect(target.toString(), 302)
          }
        }
        return response
      })
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
      // The desktop app asks this at start-up: the oldest version still allowed. Public, and cached for a few minutes.
      .get('/app-config', (c) => {
        const minimum = (c.env.MIN_APP_VERSION ?? '').trim()
        c.header('cache-control', 'public, max-age=300')
        // The site key is only offered when the secret is set too, matching when the server asks for a challenge.
        const siteKey = (c.env.TURNSTILE_SITE_KEY ?? '').trim()
        return c.json({
          minimumVersion: parseVersion(minimum) ? minimum : null,
          turnstileSiteKey: siteKey && c.env.TURNSTILE_SECRET_KEY ? siteKey : null
        })
      })
      // Feature flags for one install. Public (no sign-in) and cheap: the table is read at most once per cache period.
      .get('/flags', zValidator('query', flagsQuerySchema), async (c) => {
        const { channel, id } = c.req.valid('query')
        const rules = await loadRules(c.var.db, Date.now(), options.flagCacheMs ?? 30_000)
        c.header('cache-control', 'private, max-age=60')
        return c.json({ flags: evaluateFlags(rules, channel, id) })
      })
      // The page /t/<slug>/sign-in: a team's own company sign-in. Public, and it says nothing beyond the team's name,
      // and only for a team that has a company sign-in whose domain was proven (anyone else gets the same 404, so the
      // address cannot be used to find out which teams exist).
      .get('/team-sign-in/:slug', async (c) => {
        const slug = c.req.param('slug').toLowerCase()
        if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug))
          throw new HTTPException(404, { message: 'Not found' })
        const [team] = await c.var.db
          .select({ name: schema.organization.name })
          .from(schema.organization)
          .innerJoin(
            schema.ssoProvider,
            eq(schema.ssoProvider.organizationId, schema.organization.id)
          )
          .where(
            and(eq(schema.organization.slug, slug), eq(schema.ssoProvider.domainVerified, true))
          )
          .limit(1)
        if (!team) throw new HTTPException(404, { message: 'Not found' })
        c.header('cache-control', 'private, max-age=60')
        return c.json({ name: team.name })
      })
      // Fill in a company's sign-in settings from its issuer address. For staff and for owners and admins of a team.
      .get('/sso-discover', requireSession(true), async (c) => {
        const [staff] = await c.var.db
          .select({ role: schema.user.role })
          .from(schema.user)
          .where(eq(schema.user.id, c.var.userId))
        const [seat] = await c.var.db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.userId, c.var.userId),
              inArray(schema.member.role, ['owner', 'admin'])
            )
          )
        if (staff?.role !== 'admin' && !seat)
          throw new HTTPException(403, { message: 'Not allowed' })
        try {
          return c.json(await discoverIssuer(c.req.query('issuer') ?? ''))
        } catch (error) {
          if (error instanceof DiscoveryError)
            throw new HTTPException(400, { message: error.message })
          throw error
        }
      })
      // Directory sync: the company's identity provider calls /scim/v2 with a bearer token; owners manage tokens.
      .route('/scim/v2', createScimApi())
      .route('/scim-connections', createScimAdmin(requireSession(true)))
      .route('/workspace', createWorkspaceApi(requireSession(true)))
      .route('/todos', createTodosApi(requireSession(true)))
      .route('/presence', createPresenceApi(requireSession(true)))
      .route('/preferences', preferences)
      .route('/devices', devices)
      .route('/feedback', feedback)
      .route('/account/deletion/cancel-with-token', cancelByToken)
      .route('/account/email-change/confirm', confirmEmail)
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
