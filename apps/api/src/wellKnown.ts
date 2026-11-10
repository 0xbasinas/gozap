/** OAuth clients look for these at the site root, so the Worker must be asked to answer them (see wrangler.jsonc). */
const PREFIXES = [
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
  '/.well-known/openid-configuration'
]

export const isDiscoveryPath = (pathname: string): boolean =>
  PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
