/** True when the address is at one of the domains (a comma-separated list) or at a subdomain of one. */
export function emailInDomains(email: string, domains: string): boolean {
  const host = email.split('@')[1]?.toLowerCase() ?? ''
  return domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .some((d) => d && (host === d || host.endsWith('.' + d)))
}
