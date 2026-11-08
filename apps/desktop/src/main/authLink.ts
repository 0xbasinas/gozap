/** The path the web site sends the browser back to after sign-in: <scheme>:/auth/callback#token=<code> */
export const AUTH_CALLBACK_PATH = '/auth/callback'

/** The one-time code is base64url of a small JSON object; refuse anything else before it goes near the network. */
const TOKEN_PATTERN = /^[A-Za-z0-9_.=-]{1,2048}$/

/**
 * Pull the sign-in code out of a deep link, or null when the link is not a sign-in callback.
 * Accepts `scheme:/auth/callback#token=...` and `scheme://auth/callback#token=...`.
 */
export function parseAuthCallback(url: string, scheme: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${scheme}:`) return null
  if (`/${parsed.hostname}${parsed.pathname}`.replace(/^\/\//, '/') !== AUTH_CALLBACK_PATH)
    return null
  if (!parsed.hash.startsWith('#token=')) return null
  const token = parsed.hash.slice('#token='.length)
  return TOKEN_PATTERN.test(token) ? token : null
}
