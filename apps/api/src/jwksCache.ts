/**
 * Keeps our public signing keys in memory for a short while, so most /api/mcp calls skip the database read.
 * The keys only change on a rotation (not configured here), and a call that carries a key we have not seen is
 * answered correctly after the time runs out, so a minute is short enough.
 */
export const JWKS_KEEP_MS = 60_000

let kept: { at: number; value: unknown } | null = null

export async function cachedJwks<T>(load: () => Promise<T>, now = Date.now()): Promise<T> {
  if (kept && now - kept.at < JWKS_KEEP_MS) return kept.value as T
  const value = await load()
  kept = { at: now, value }
  return value
}

export function forgetJwks(): void {
  kept = null
}
