import { DiscoveryError, publicHttps } from './ssoDiscovery'

/**
 * Fetches an AI app's "client ID metadata document" (and the keys it points to). The address comes from a stranger,
 * so this is the part of the MCP set-up to be careful with.
 *
 * Better Auth asks for a transport that pins the resolved address. A Worker cannot do that, but it also cannot reach
 * private networks at all (its requests leave from Cloudflare's network), which is what pinning protects against.
 * What it can do, and what this does: https only, a public host name (no IP addresses, no local names, no ports or
 * logins), no redirects, a short time limit and a small body.
 */
export const MAX_METADATA_BYTES = 64_000
const TIMEOUT_MS = 5000

export async function fetchClientMetadataResource(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const raw = input instanceof Request ? input.url : String(input)
  let url: URL
  try {
    url = publicHttps(raw, 'The client address')
  } catch (error) {
    if (error instanceof DiscoveryError) return new Response(error.message, { status: 400 })
    throw error
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  // Read at most the limit, so a huge answer never sits in memory.
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (reader) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_METADATA_BYTES) {
      await reader.cancel()
      return new Response('The document is too large.', { status: 413 })
    }
    chunks.push(value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Response(body, { status: response.status, headers: response.headers })
}
