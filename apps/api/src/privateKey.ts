/**
 * Checks for a company's "private key" sign-in (OpenID Connect `private_key_jwt`): instead of a shared client secret,
 * our server signs a short statement with a private key and the company checks it with the matching public key.
 * The key is pasted once as a PKCS#8 PEM and stored the way client secrets are (encrypted, see secretStore.ts).
 */

/** The signing methods we accept, with the key type each one needs. */
export const KEY_ALGORITHMS = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
  PS256: { name: 'RSA-PSS', hash: 'SHA-256' },
  ES256: { name: 'ECDSA', namedCurve: 'P-256' }
} as const

export type KeyAlgorithm = keyof typeof KEY_ALGORITHMS

export const isKeyAlgorithm = (value: unknown): value is KeyAlgorithm =>
  typeof value === 'string' && Object.hasOwn(KEY_ALGORITHMS, value)

/** The raw bytes inside a PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"), or null when it is not one. */
function pemBytes(pem: string): Uint8Array<ArrayBuffer> | null {
  const match = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----$/.exec(
    pem.trim()
  )
  if (!match?.[1]) return null
  try {
    return Uint8Array.from(atob(match[1].replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

/** Why a pasted key cannot be used, or null when it is a valid private key for that signing method. */
export async function checkPrivateKey(pem: unknown, algorithm: unknown): Promise<string | null> {
  if (typeof pem !== 'string' || pem.length > 8_000)
    return 'Paste the private key (a PKCS#8 file that starts with -----BEGIN PRIVATE KEY-----).'
  if (!isKeyAlgorithm(algorithm)) return 'Choose RS256, PS256 or ES256 as the signing method.'
  const bytes = pemBytes(pem)
  if (!bytes) return 'The private key must be a PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----").'
  try {
    await crypto.subtle.importKey('pkcs8', bytes, KEY_ALGORITHMS[algorithm], false, ['sign'])
    return null
  } catch {
    return `That is not a usable ${algorithm} private key.`
  }
}
