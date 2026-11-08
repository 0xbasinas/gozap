import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { sso } from '@better-auth/sso'
import * as Sentry from '@sentry/cloudflare'
import { betterAuth } from 'better-auth'
import { count, eq } from 'drizzle-orm'
import { apiKey } from '@better-auth/api-key'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, captcha, magicLink, organization } from 'better-auth/plugins'
import { ac, roles } from './permissions'
import { withEncryptedProviderSecrets } from './secretStore'
import { eventForCall, recordAudit } from './audit'
import type { Db } from './db'
import { schema } from './db'
import { BRAND } from './brand'
import {
  INVITATION_DAYS,
  invitationEmail,
  MAX_MEMBERS_PER_TEAM,
  MAX_TEAMS_PER_PERSON
} from './teams'
import { newDeviceEmail, recordSignIn } from './signIns'
import { magicLinkEmail, type EmailSender } from './email'
import { isSuppressed } from './suppression'
import type { Bindings } from './env'

/** The most API keys one person may have. */
export const MAX_API_KEYS = 10

/** Used when the variable APP_NAME is not set. */
export const DEFAULT_APP_NAME = 'Electron Desktop Template'

export interface AuthDeps {
  db: Db
  env: Bindings
  email: EmailSender
  /** Runs work after the response is sent (`ctx.waitUntil` on Workers). */
  waitUntil: (promise: Promise<unknown>) => void
}

/**
 * Better Auth, configured for Workers + D1. It is created per request because the D1 binding only exists
 * inside a request; creating it is cheap.
 *
 * Free-tier choices: no passwords (so no CPU-heavy hashing, which would not fit the 10 ms Workers Free
 * limit), a signed session cookie cache (so most requests do not read the database), and rate limiting
 * only on the sign-in endpoints (each counted request is a D1 write).
 */
export function createAuth({ db, env, email, waitUntil }: AuthDeps) {
  const extraOrigins = (env.TRUSTED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)

  const appName = env.APP_NAME || DEFAULT_APP_NAME

  return betterAuth({
    appName,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL, ...extraOrigins],
    // The one thing the single sign-on plugin keeps in clear (a company's client secret) is encrypted on the way in.
    database: withEncryptedProviderSecrets(
      drizzleAdapter(db, { provider: 'sqlite', schema }),
      env.BETTER_AUTH_SECRET
    ),
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // The session is also kept in a signed cookie for 1 minute, so most requests skip the database.
      cookieCache: { enabled: true, maxAge: 60 }
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 30,
      customRules: { '/get-session': false }
    },
    hooks: {
      // At most MAX_API_KEYS keys per person, so one account cannot fill the table.
      before: createAuthMiddleware(async (ctx) => {
        // SAML needs more CPU per sign-in than the free Workers plan allows, so only OpenID Connect is offered.
        if (
          ctx.path === '/sso/register' &&
          (ctx.body as { samlConfig?: unknown } | undefined)?.samlConfig
        )
          throw new APIError('BAD_REQUEST', {
            message: 'Only OpenID Connect providers are supported.'
          })
        if (ctx.path !== '/api-key/create') return
        const session = ctx.context.session ?? (await getSessionFromCtx(ctx))
        if (!session) return
        const [row] = await db
          .select({ n: count() })
          .from(schema.apikey)
          .where(eq(schema.apikey.referenceId, session.user.id))
        if ((row?.n ?? 0) >= MAX_API_KEYS)
          throw new APIError('BAD_REQUEST', {
            message: 'You have the most keys allowed. Delete one first.'
          })
      }),
      // The security trail: failed sign-ins and account changes. After the response, and never fatal.
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned
        const failed = returned instanceof APIError
        const event = eventForCall({
          path: ctx.path,
          failed,
          errorCode: failed ? (returned.body?.code as string | undefined) : undefined,
          location: ctx.context.responseHeaders?.get('location')
        })
        if (!event) return
        const sessionUser = ctx.context.session?.user.id ?? null
        const admin = ctx.path.startsWith('/admin/')
        // Who did it and who it was done to. A refused call, or a removed account, has no row to point at.
        let actorId: string | null = null
        let userId: string | null = sessionUser
        if (admin) {
          const stopping = ctx.path === '/admin/stop-impersonating'
          actorId = stopping
            ? ((ctx.context.session?.session as { impersonatedBy?: string | null } | undefined)
                ?.impersonatedBy ?? null)
            : sessionUser
          const asked = (ctx.body as { userId?: string } | undefined)?.userId ?? null
          userId = stopping
            ? sessionUser
            : event.outcome === 'success' && ctx.path !== '/admin/remove-user'
              ? asked
              : null
        }
        waitUntil(
          recordAudit(db, {
            ...event,
            userId,
            actorId,
            ipAddress: ctx.headers?.get('cf-connecting-ip') ?? null,
            userAgent: ctx.headers?.get('user-agent') ?? null,
            now: Date.now()
          }).catch((error: unknown) => {
            console.error('Could not record the audit event', error)
            Sentry.captureException(error)
          })
        )
      })
    },
    databaseHooks: {
      user: {
        create: {
          // A company's identity provider may only create accounts at the company's own domain. Without this a
          // provider whose domain was proven could mint accounts (and keep a session) for any address, and the
          // real owner of that address would later sign in to an account someone else already holds.
          before: async (created, ctx) => {
            const path = ctx?.path ?? ''
            if (!path.startsWith('/sso/callback')) return
            const providerId = (ctx?.params as { providerId?: string } | undefined)?.providerId
            const [provider] = providerId
              ? await db
                  .select({ domain: schema.ssoProvider.domain })
                  .from(schema.ssoProvider)
                  .where(eq(schema.ssoProvider.providerId, providerId))
              : []
            const host = created.email.split('@')[1]?.toLowerCase() ?? ''
            const allowed = (provider?.domain ?? '').toLowerCase()
            if (!allowed || (host !== allowed && !host.endsWith('.' + allowed)))
              throw new APIError('FORBIDDEN', {
                message: 'This address does not belong to the company that signed you in.'
              })
          }
        }
      },
      session: {
        create: {
          // A new session is a sign-in: remember it for the activity list, and warn by email when it is from a
          // browser and system the account has not used before. After the response, and never fatal.
          after: async (created) => {
            waitUntil(
              (async () => {
                const now = Date.now()
                const ipAddress = created.ipAddress ?? null
                await recordAudit(db, {
                  type: 'user_signed_in',
                  outcome: 'success',
                  userId: created.userId,
                  ipAddress,
                  userAgent: created.userAgent ?? null,
                  now
                })
                const recorded = await recordSignIn(db, {
                  userId: created.userId,
                  ipAddress,
                  userAgent: created.userAgent ?? null,
                  now
                })
                if (!recorded.newDevice) return
                const [owner] = await db
                  .select({ email: schema.user.email })
                  .from(schema.user)
                  .where(eq(schema.user.id, created.userId))
                if (!owner || (await isSuppressed(db, owner.email))) return
                await email.send({
                  to: owner.email,
                  ...newDeviceEmail(appName, recorded.label, ipAddress, now)
                })
              })().catch((error: unknown) => {
                console.error('Could not record the sign-in', error)
                Sentry.captureException(error)
              })
            )
          }
        }
      }
    },
    advanced: {
      // Cloudflare sets this header on every request and overwrites any value the client sends.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // Rate-limit bookkeeping and email sending happen after the response.
      backgroundTasks: { handler: waitUntil }
    },
    plugins: [
      // Bot check on the one endpoint that sends email. Only when both keys are set, so the site never asks for a
      // challenge it cannot show. The client sends the token in the `x-captcha-response` header.
      ...(env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SITE_KEY
        ? [
            captcha({
              provider: 'cloudflare-turnstile',
              secretKey: env.TURNSTILE_SECRET_KEY,
              endpoints: ['/sign-in/magic-link']
            })
          ]
        : []),
      // Keys a person makes on their account page to call the API from scripts. Sent in the x-api-key header.
      apiKey({
        defaultPrefix: 'key_',
        requireName: true,
        // The key is stored as a hash; the full key is shown once, when it is made.
        keyExpiration: { defaultExpiresIn: 90 * 86_400, minExpiresIn: 1, maxExpiresIn: 365 },
        rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 60 },
        // Usage counters are written after the response, so checking a key does not wait for a database write.
        deferUpdates: true,
        // A key can only read the account unless a route asks for more; every route that accepts a key names the
        // permission it needs (see /v1/me).
        permissions: { defaultPermissions: { account: ['read'] } }
      }),
      // Teams: people who share a workspace. Anyone may start up to MAX_TEAMS_PER_PERSON; the owner invites by email.
      organization({
        organizationLimit: MAX_TEAMS_PER_PERSON,
        membershipLimit: MAX_MEMBERS_PER_TEAM,
        invitationExpiresIn: INVITATION_DAYS * 86_400,
        cancelPendingInvitationsOnReInvite: true,
        sendInvitationEmail: async (data) => {
          // After the response, and never to an address that bounced or complained.
          waitUntil(
            (async () => {
              if (await isSuppressed(db, data.email)) return
              await email.send({
                to: data.email,
                ...invitationEmail(appName, {
                  teamName: data.organization.name,
                  inviter: data.inviter.user.name || data.inviter.user.email,
                  url: new URL(`/accept-invitation/${data.id}`, env.BETTER_AUTH_URL).href
                })
              })
            })().catch((error: unknown) => {
              console.error('Could not send the invitation', error)
              Sentry.captureException(error)
            })
          )
        }
      }),
      // Single sign-on for companies, by OpenID Connect. Only admins may register a provider (a company is set up by
      // us, not self-service), and a provider's domain must be proven with a DNS record before it can sign anyone in.
      sso({
        providersLimit: (user) => ((user as { role?: string | null }).role === 'admin' ? 25 : 0),
        domainVerification: { enabled: true }
      }),
      // Staff tools (roles: admin, support). Banning also ends the person's sessions. Nobody is an admin until
      // `pnpm admin:grant <email>` says so; the sign-up flow never grants a role.
      admin({
        ac,
        roles,
        defaultRole: 'user',
        bannedUserMessage: 'This account has been suspended.'
      }),
      // Lets the desktop app sign in through the system browser (PKCE, then a one-time code over the deep link).
      electron(),
      // Sign in with a fingerprint, face or security key instead of waiting for an email. A passkey is tied to the
      // site's domain (rpID), so it cannot be used on a look-alike site. Passkeys are added from the account page.
      passkey({ rpID: new URL(env.BETTER_AUTH_URL).hostname, rpName: appName }),
      magicLink({
        expiresIn: 5 * 60,
        // Store only a hash of the token, so a leaked database cannot be used to sign in.
        storeToken: 'hashed',
        sendMagicLink: async ({ email: to, url }) => {
          // Not awaited: the response time must not reveal whether the address already has an account.
          waitUntil(
            (async () => {
              // An address that bounced or complained recently gets nothing (the answer to the person is the same).
              if (await isSuppressed(db, to)) {
                console.warn('Skipped a sign-in email to a suppressed address')
                return
              }
              await email.send({
                to,
                ...magicLinkEmail(url, appName, {
                  logoUrl: new URL('/email-logo.png', env.BETTER_AUTH_URL).href,
                  color: BRAND.color,
                  onColor: BRAND.onColor
                })
              })
            })().catch((error: unknown) => {
              console.error('Could not send the sign-in email', error)
              // The one failure that silently locks people out, so make sure someone hears about it.
              Sentry.captureException(error)
            })
          )
        }
      })
    ]
  })
}

export type Auth = ReturnType<typeof createAuth>
