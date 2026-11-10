/**
 * Looks up a company's OpenID Connect settings from its issuer address, so an owner only types the issuer, client id
 * and secret. The Worker fetches the public discovery document (https only, no redirects, small, quick); the sign-in
 * plugin is then told the endpoints directly, so the identity provider's address never has to be added to
 * `trustedOrigins` (which is global and also decides which sites may call the API).
 */
export interface Discovered {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksEndpoint: string
  userInfoEndpoint?: string
  tokenEndpointAuthMethods: string[]
}

export class DiscoveryError extends Error {}

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|\[.*\]|\d{1,3}(\.\d{1,3}){3})$/i

/** A public https address with a real host name: no IP addresses, local names, credentials or odd ports. */
export function publicHttps(value: unknown, what: string): URL {
  let url: URL
  try {
    url = new URL(String(value))
  } catch {
    throw new DiscoveryError(`${what} is not a web address.`)
  }
  if (url.protocol !== 'https:') throw new DiscoveryError(`${what} must use https.`)
  if (url.username || url.password) throw new DiscoveryError(`${what} must not contain a login.`)
  if (url.port && url.port !== '443')
    throw new DiscoveryError(`${what} must use the normal https port.`)
  if (PRIVATE_HOST.test(url.hostname) || !url.hostname.includes('.'))
    throw new DiscoveryError(`${what} must be a public host name.`)
  return url
}

export async function discoverIssuer(
  issuerInput: string,
  fetcher: typeof fetch = fetch
): Promise<Discovered> {
  const issuer = publicHttps(issuerInput, 'The issuer')
  const base = issuer.href.replace(/\/$/, '')
  const response = await fetcher(`${base}/.well-known/openid-configuration`, {
    redirect: 'error',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(5000)
  }).catch(() => {
    throw new DiscoveryError('Could not reach that issuer.')
  })
  if (!response.ok)
    throw new DiscoveryError('That issuer has no OpenID Connect discovery document.')
  const text = await response.text()
  if (text.length > 100_000) throw new DiscoveryError('The discovery document is too large.')
  let doc: Record<string, unknown>
  try {
    doc = JSON.parse(text) as Record<string, unknown>
  } catch {
    throw new DiscoveryError('The discovery document is not valid JSON.')
  }
  if (typeof doc.issuer !== 'string' || doc.issuer.replace(/\/$/, '') !== base)
    throw new DiscoveryError('The issuer in the discovery document does not match.')
  const endpoint = (key: string, required: boolean): string | undefined => {
    const value = doc[key]
    if (value === undefined && !required) return undefined
    return publicHttps(value, key).href
  }
  const methods = Array.isArray(doc.token_endpoint_auth_methods_supported)
    ? doc.token_endpoint_auth_methods_supported.filter((m): m is string => typeof m === 'string')
    : []
  return {
    issuer: doc.issuer,
    authorizationEndpoint: endpoint('authorization_endpoint', true)!,
    tokenEndpoint: endpoint('token_endpoint', true)!,
    jwksEndpoint: endpoint('jwks_uri', true)!,
    userInfoEndpoint: endpoint('userinfo_endpoint', false),
    tokenEndpointAuthMethods: methods
  }
}
