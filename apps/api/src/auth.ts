import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { sso } from '@better-auth/sso'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { DEVICE_CODE_GRANT_TYPE, oauthDeviceAuthorization } from '@better-auth/oauth-provider'
import * as Sentry from '@sentry/cloudflare'
import { betterAuth } from 'better-auth'
import { count, eq, inArray } from 'drizzle-orm'
import { apiKey } from '@better-auth/api-key'
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api'
import { admin, captcha, jwt, magicLink, organization } from 'better-auth/plugins'
import { ac, roles } from './permissions'
import { fetchClientMetadataResource } from './cimdFetch'
import { checkPrivateKey } from './privateKey'
import { openSecret, withEncryptedProviderSecrets } from './secretStore'
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
import { isDeprovisioned, ssoLinkRefusal } from './scimStore'
import { DiscoveryError, publicHttps } from './ssoDiscovery'
import { revokeAppAccessStatements } from './oauthPrune'
import { emailInDomains } from './domains'
import { tombstoneStatements } from './tombstones'
import type { Bindings } from './env'

/** The most API keys one person may have. */
export const MAX_API_KEYS = 10

/** The scope an AI app is asked for to read the account (see /api/mcp). */
export const MCP_READ_SCOPE = 'mcp:read'
export const MCP_WRITE_SCOPE = 'mcp:write'

/** The address of the MCP endpoint: tokens made for AI apps are only good there. */
export const mcpResource = (baseUrl: string): string => new URL('/api/mcp', baseUrl).href

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
  // Work found by a before hook that must only run once the call is known to have succeeded (one object per request).
  const sessionsToEnd = new Set<string>()
  const teamsLosingProviders = new Set<string>()
  const afterDelete = new Map<
    string,
    ReturnType<typeof tombstoneStatements> extends Promise<infer S> ? S : never
  >()

  return betterAuth({
    appName,
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL, ...extraOrigins],
    // The one thing the single sign-on plugin keeps in clear (a company's client secret) is encrypted on the way in.
    database: withEncryptedProviderSecrets(
      drizzleAdapter(db, { provider: 'sqlite', schema }),
      env.BETTER_AUTH_SECRET,
      // Someone their company's directory switched off must not walk back into the team (by invitation or by
      // single sign-on): both add the member through the adapter.
      async (model, data) => {
        if (
          model === 'member' &&
          typeof data.organizationId === 'string' &&
          typeof data.userId === 'string' &&
          (await isDeprovisioned(db, data.organizationId, data.userId))
        )
          throw new APIError('FORBIDDEN', {
            message: 'Your company has switched off your access to this team.'
          })
        // Company sign-in only links to a person their directory has not switched off, and never to an account that
        // the directory ties to someone else (see ssoLinkRefusal).
        if (
          model === 'account' &&
          typeof data.providerId === 'string' &&
          typeof data.userId === 'string' &&
          typeof data.accountId === 'string' &&
          !['credential', 'magic-link', 'passkey'].includes(data.providerId)
        ) {
          const refusal = await ssoLinkRefusal(db, {
            providerId: data.providerId,
            userId: data.userId,
            subject: data.accountId
          })
          if (refusal) {
            waitUntil(
              recordAudit(db, {
                type: 'user_sign_in_failed',
                outcome: 'failure',
                userId: data.userId,
                code: refusal === 'deprovisioned' ? 'SSO_DEPROVISIONED' : 'SSO_SUBJECT_TAKEN',
                now: Date.now()
              }).catch((error: unknown) => console.error('Could not record the refusal', error))
            )
            throw new APIError('FORBIDDEN', {
              message:
                refusal === 'deprovisioned'
                  ? 'Your company has switched off your access.'
                  : 'This company sign-in belongs to another account.'
            })
          }
        }
      }
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
      customRules: {
        '/get-session': false,
        // These start a fetch of an AI app's address (or read one), so they get a tighter limit than the rest.
        '/oauth2/authorize': { window: 60, max: 10 },
        '/oauth2/public-client': { window: 60, max: 20 },
        '/oauth2/token': { window: 60, max: 20 },
        '/device/code': { window: 60, max: 10 },
        // The plugin also serves these. They check the caller's client credentials (a database read and, for a signed
        // token, a signature check each time), so a stranger guessing at them is limited well below the general rule.
        '/oauth2/introspect': { window: 60, max: 20 },
        '/oauth2/revoke': { window: 60, max: 20 },
        '/oauth2/end-session': { window: 60, max: 10 },
        '/oauth2/register': { window: 60, max: 5 }
      }
    },
    hooks: {
      // At most MAX_API_KEYS keys per person, so one account cannot fill the table.
      before: createAuthMiddleware(async (ctx) => {
        // While staff view the site as a person they may look, not act as them. Only ending the view or signing out
        // is allowed. (Our own routes check the same in requireSession.)
        if (
          ctx.request?.method === 'POST' &&
          ctx.path !== '/admin/stop-impersonating' &&
          ctx.path !== '/sign-out'
        ) {
          const viewer = ctx.context.session ?? (await getSessionFromCtx(ctx))
          if ((viewer?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy)
            throw new APIError('FORBIDDEN', {
              message: 'Not allowed while viewing as this person.'
            })
        }
        // RP-initiated logout is not used by any AI app, and for an unknown app id it would make this Worker fetch that
        // app's address for a stranger (and fail with a 500). Not offered.
        if (ctx.path === '/oauth2/end-session')
          throw new APIError('NOT_FOUND', { message: 'Not found' })
        // SAML needs more CPU per sign-in than the free Workers plan allows, so only OpenID Connect is offered.
        if (
          ctx.path === '/sso/register' &&
          (ctx.body as { samlConfig?: unknown } | undefined)?.samlConfig
        )
          throw new APIError('BAD_REQUEST', {
            message: 'Only OpenID Connect providers are supported.'
          })
        // Every address the sign-in will call must be a public https address, whoever registers it. Our own form fills
        // them in from the issuer's discovery document, which is checked the same way (ssoDiscovery.ts), but this route
        // takes whatever it is given. The simplest safe rule has no exceptions: there is no TRUSTED_IDP_ORIGINS setting,
        // and an identity provider on a private network is not supported (a Worker cannot reach one anyway).
        if (ctx.path === '/sso/register' || ctx.path === '/sso/update-provider') {
          const body = ctx.body as
            { issuer?: string; oidcConfig?: Record<string, unknown> } | undefined
          const addresses: [string, unknown][] = [
            ['The issuer', body?.issuer],
            ...[
              'authorizationEndpoint',
              'tokenEndpoint',
              'jwksEndpoint',
              'userInfoEndpoint',
              'discoveryEndpoint'
            ].map((key): [string, unknown] => [`The ${key}`, body?.oidcConfig?.[key]])
          ]
          for (const [what, value] of addresses) {
            if (value === undefined || value === null || value === '') continue
            try {
              publicHttps(value, what)
            } catch (error) {
              throw new APIError('BAD_REQUEST', {
                message: error instanceof DiscoveryError ? error.message : `${what} is not valid.`
              })
            }
          }
        }
        // Signing in to the company's token endpoint with a private key instead of a shared secret: the pasted key (it
        // travels in the `clientSecret` field, which is stored encrypted) must be a real PKCS#8 key for the chosen method.
        if (ctx.path === '/sso/register' || ctx.path === '/sso/update-provider') {
          const oidc = (ctx.body as { oidcConfig?: Record<string, unknown> } | undefined)
            ?.oidcConfig
          if (oidc?.tokenEndpointAuthentication === 'private_key_jwt') {
            const problem =
              oidc.clientSecret === undefined && ctx.path === '/sso/update-provider'
                ? null
                : await checkPrivateKey(oidc.clientSecret, oidc.privateKeyAlgorithm ?? 'RS256')
            if (problem) throw new APIError('BAD_REQUEST', { message: problem })
          }
        }
        // A provider may not be told to overwrite the name or address of people who sign in with it: the company's
        // directory (or whoever controls its claims) could then rewrite an address that other sign-ins match on.
        if (
          (ctx.path === '/sso/register' || ctx.path === '/sso/update-provider') &&
          (ctx.body as { oidcConfig?: { overrideUserInfo?: unknown } } | undefined)?.oidcConfig
            ?.overrideUserInfo === true
        )
          throw new APIError('BAD_REQUEST', {
            message: 'Replacing a person�s details at each sign-in is not supported.'
          })
        // The plugin already refuses to change the issuer, client id or endpoints while people are linked through a
        // provider. The domain is the other thing their sign-in is matched on: moving it needs the same care, so it
        // too means deleting the provider (which signs those people out) and adding it again.
        if (ctx.path === '/sso/update-provider') {
          const change = ctx.body as { providerId?: string; domain?: string } | undefined
          if (change?.providerId && change.domain !== undefined) {
            const [current] = await db
              .select({ domain: schema.ssoProvider.domain })
              .from(schema.ssoProvider)
              .where(eq(schema.ssoProvider.providerId, change.providerId))
            const [linked] = await db
              .select({ id: schema.account.id })
              .from(schema.account)
              .where(eq(schema.account.providerId, change.providerId))
              .limit(1)
            if (current && linked && current.domain !== change.domain.toLowerCase())
              throw new APIError('CONFLICT', {
                message:
                  'People already sign in through this provider. Delete it and add it again to change its domain.'
              })
          }
        }
        // Only staff may register a provider for nobody in particular. Anyone else must tie it to a team they own or
        // administer (the plugin checks that), and the domain still has to be proven with DNS before anyone signs in.
        if (ctx.path === '/sso/register') {
          const registrant = ctx.context.session ?? (await getSessionFromCtx(ctx))
          const staff = (registrant?.user as { role?: string | null } | undefined)?.role === 'admin'
          if (
            registrant &&
            !staff &&
            !(ctx.body as { organizationId?: string } | undefined)?.organizationId
          )
            throw new APIError('FORBIDDEN', { message: 'Choose the team this sign-in belongs to.' })
        }
        // Deleting a provider removes its linked accounts but not the sessions they hold. Note who they are now; the
        // sessions are ended in the after hook, once the plugin has agreed to the delete.
        if (ctx.path === '/sso/delete-provider') {
          const providerId = (ctx.body as { providerId?: string } | undefined)?.providerId
          if (providerId) {
            const linked = await db
              .select({ userId: schema.account.userId })
              .from(schema.account)
              .where(eq(schema.account.providerId, providerId))
            for (const row of linked) sessionsToEnd.add(row.userId)
          }
        }
        // A deleted team takes its company sign-ins with it (the provider table has no foreign key to teams).
        if (ctx.path === '/organization/delete') {
          const organizationId = (ctx.body as { organizationId?: string } | undefined)
            ?.organizationId
          if (organizationId) {
            const linked = await db
              .select({ userId: schema.account.userId })
              .from(schema.account)
              .innerJoin(
                schema.ssoProvider,
                eq(schema.ssoProvider.providerId, schema.account.providerId)
              )
              .where(eq(schema.ssoProvider.organizationId, organizationId))
            for (const row of linked) sessionsToEnd.add(row.userId)
            teamsLosingProviders.add(organizationId)
          }
        }
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
          location: ctx.context.responseHeaders?.get('location'),
          accepted: (ctx.body as { accept?: unknown } | undefined)?.accept === true
        })
        const sessionUser = ctx.context.session?.user.id ?? null
        if (!failed) {
          try {
            const body = ctx.body as
              { userId?: string; banExpiresIn?: number; organizationId?: string } | undefined
            // A suspended person's AI apps lose access too. A time-limited ban only pauses them (they are refused
            // on every call while it lasts), so their approvals are kept.
            if (ctx.path === '/admin/ban-user' && body?.userId && !body.banExpiresIn)
              await db.batch(revokeAppAccessStatements(db, body.userId))
            // "Sign out everywhere" also cuts off the AI apps the person approved.
            if (ctx.path === '/revoke-sessions' && sessionUser)
              await db.batch(revokeAppAccessStatements(db, sessionUser))
            if (sessionsToEnd.size > 0)
              await db
                .delete(schema.session)
                .where(inArray(schema.session.userId, [...sessionsToEnd]))
            for (const organizationId of teamsLosingProviders)
              await db
                .delete(schema.ssoProvider)
                .where(eq(schema.ssoProvider.organizationId, organizationId))
          } catch (error) {
            console.error('Could not finish the clean-up after an auth call', error)
            Sentry.captureException(error)
          }
        }
        if (!event) return
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
        delete: {
          // A directory (SCIM) that still lists the person must not quietly create the account again. The directory
          // records go with the account, so they are read now and the blocks are written once the delete is done.
          before: async (deleted) => {
            afterDelete.set(deleted.id, await tombstoneStatements(db, deleted.id))
          },
          after: async (deleted) => {
            await db.batch([
              ...revokeAppAccessStatements(db, deleted.id),
              ...(afterDelete.get(deleted.id) ?? [])
            ])
            afterDelete.delete(deleted.id)
          }
        },
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
            if (!provider || !emailInDomains(created.email, provider.domain))
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
    // The session JWT route would share the AI apps' token signing key, so it stays off.
    disabledPaths: ['/token'],
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
      // AI apps (Model Context Protocol): this API is an OAuth 2.1 server and /api/mcp is the protected resource. Apps
      // are identified by a metadata document at their own address (cimd); nothing can register itself, and nobody
      // can create clients through the CRUD routes. Tokens are signed with an EdDSA key kept in the database.
      jwt({
        disableSettingJwtHeader: true,
        jwks: { keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' } }
      }),
      mcp({
        loginPage: '/sign-in',
        consentPage: '/consent',
        resource: mcpResource(env.BETTER_AUTH_URL),
        scopes: ['openid', 'profile', 'email', 'offline_access', MCP_READ_SCOPE, MCP_WRITE_SCOPE],
        grantTypes: ['authorization_code', 'refresh_token', DEVICE_CODE_GRANT_TYPE],
        // The default 30 s window lets a stolen refresh token be replayed once; strict is the safer choice.
        refreshTokenReuseInterval: 0,
        // Only staff may look at or remove clients; clients are created by cimd, never by hand.
        clientPrivileges: ({ action, user }) =>
          (user as { role?: string | null } | undefined)?.role === 'admin' && action !== 'create',
        resourcePrivileges: () => false
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: 'mcp-2026-07-28' }),
      // For AI apps with no browser of their own (a terminal agent): they show a short code, the person types it on
      // /device while signed in and approves there. The approval page names the app and what it asks for.
      oauthDeviceAuthorization({ verificationUri: '/device' }),
      // Single sign-on for companies, by OpenID Connect. Only admins may register a provider (a company is set up by
      // us, not self-service), and a provider's domain must be proven with a DNS record before it can sign anyone in.
      sso({
        // Staff set up companies; a team owner or admin may add a few for their own team (see the before hook).
        providersLimit: (user) => ((user as { role?: string | null }).role === 'admin' ? 25 : 3),
        domainVerification: { enabled: true },
        // A person who signs in through a team's provider joins that team as a plain member. A role is never taken
        // from the company's group claims: that would let whoever manages the group run the team's sign-in controls.
        organizationProvisioning: { disabled: false, defaultRole: 'member' },
        // The key for a provider that signs in with a private key: read from its (encrypted) row at sign-in time only.
        resolvePrivateKey: async ({ providerId }) => {
          const [row] = await db
            .select({ oidcConfig: schema.ssoProvider.oidcConfig })
            .from(schema.ssoProvider)
            .where(eq(schema.ssoProvider.providerId, providerId))
          const config = JSON.parse(row?.oidcConfig ?? '{}') as {
            clientSecret?: string
            privateKeyId?: string
            privateKeyAlgorithm?: string
          }
          if (!config.clientSecret) return {}
          return {
            privateKeyPem: await openSecret(env.BETTER_AUTH_SECRET, config.clientSecret),
            ...(config.privateKeyId ? { kid: config.privateKeyId } : {}),
            algorithm: config.privateKeyAlgorithm ?? 'RS256'
          }
        },
        provisionUser: async ({ user }) => {
          waitUntil(
            recordAudit(db, {
              type: 'sso_user_provisioned',
              outcome: 'success',
              userId: user.id,
              now: Date.now()
            }).catch((error: unknown) => {
              console.error('Could not record the provisioning', error)
              Sentry.captureException(error)
            })
          )
        }
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
