import { electronProxyClient } from '@better-auth/electron/proxy'
import { apiKeyClient } from '@better-auth/api-key/client'
import { ssoClient } from '@better-auth/sso/client'
import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/react'
import { adminClient, magicLinkClient, organizationClient } from 'better-auth/client/plugins'
import { DESKTOP_SCHEME } from '../config'

/**
 * Talks to /api/auth on this same origin, so the session cookie is first-party.
 * The Electron proxy plugin is what lets this site hand a finished sign-in over to the desktop app.
 */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  plugins: [
    magicLinkClient(),
    adminClient(),
    apiKeyClient(),
    organizationClient(),
    ssoClient({ domainVerification: { enabled: true } }),
    passkeyClient(),
    electronProxyClient({ protocol: { scheme: DESKTOP_SCHEME } })
  ]
})
