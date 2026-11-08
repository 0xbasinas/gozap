// Only used by `pnpm auth:schema`, which asks Better Auth which tables the enabled plugins need and writes
// them to src/db/auth-schema.ts. Keep the plugin list in step with src/auth.ts, then run the script again.
import { drizzleAdapter } from '@better-auth/drizzle-adapter'
import { electron } from '@better-auth/electron'
import { passkey } from '@better-auth/passkey'
import { betterAuth } from 'better-auth'
import { magicLink } from 'better-auth/plugins'
import { drizzle } from 'drizzle-orm/d1'

export const auth = betterAuth({
  database: drizzleAdapter(drizzle({} as D1Database), { provider: 'sqlite' }),
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [electron(), passkey(), magicLink({ sendMagicLink: async () => {} })]
})
