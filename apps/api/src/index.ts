import * as Sentry from '@sentry/cloudflare'
import { createApp } from './app'
import type { Bindings } from './env'
import { withPreviewUrl } from './preview'

export type { AppType } from './app'
export type { Bindings } from './env'

const app = createApp()

// The Worker. Static files of the web app are served by Cloudflare without running this code (see wrangler.jsonc).
//
// Errors are reported to Sentry when the secret SENTRY_DSN is set; without it nothing is sent. Only errors are
// collected (no traces), and no user identity: the goal is "tell me when sign-in starts failing", not tracking.
export default Sentry.withSentry(
  (env: Bindings) => ({
    dsn: env.SENTRY_DSN || undefined,
    environment: new URL(env.BETTER_AUTH_URL).hostname,
    tracesSampleRate: 0,
    dataCollection: { userInfo: false }
  }),
  { fetch: (request, env: Bindings, ctx) => app.fetch(request, withPreviewUrl(request, env), ctx) }
)
