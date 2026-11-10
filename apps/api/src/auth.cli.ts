// Only used by `pnpm auth:schema`, which asks Better Auth which tables the enabled plugins need and writes
// them to src/db/auth-schema.ts. Keep the plugin list in step with src/auth.ts, then run the script again.
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { apiKey } from '@better-auth/api-key'
import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { sso } from '@better-auth/sso'
import { cimd } from '@better-auth/cimd'
import { mcp } from '@better-auth/mcp'
import { oauthDeviceAuthorization } from '@better-auth/oauth-provider'
import { betterAuth } from 'better-auth'
import { admin, jwt, magicLink, organization } from 'better-auth/plugins'
import { ac, roles } from './permissions'
import { drizzle } from 'drizzle-orm/d1'

export const auth = betterAuth({
  baseURL: 'https://example.com',
  disabledPaths: ['/token'],
  database: drizzleAdapter(drizzle({} as D1Database), { provider: 'sqlite' }),
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [
    apiKey({ requireName: true }),
    electron(),
    admin({ ac, roles }),
    organization(),
    sso({ domainVerification: { enabled: true } }),
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: '/sign-in',
      consentPage: '/consent',
      resource: 'https://example.com/api/mcp'
    }),
    cimd({
      fetchClientMetadataResource: async () => new Response('', { status: 404 }),
      metadataProfile: 'mcp-2026-07-28'
    }),
    oauthDeviceAuthorization({ verificationUri: '/device' }),
    passkey(),
    magicLink({ sendMagicLink: async () => {} })
  ]
})
