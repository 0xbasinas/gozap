import type { Bindings } from './env'

/**
 * A preview deploy (one per pull request) has its own address, which is only known once it is running. When the
 * variable PREVIEW is "true" the site address is taken from the request instead of BETTER_AUTH_URL, so sign-in
 * links, cookies and passkeys all belong to that preview. Production never sets PREVIEW.
 */
export function withPreviewUrl(request: Request, env: Bindings): Bindings {
  if (env.PREVIEW !== 'true') return env
  return { ...env, BETTER_AUTH_URL: new URL(request.url).origin }
}
