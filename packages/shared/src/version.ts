import { z } from 'zod'

/** What the app asks the API at start-up: the oldest version that may still be used (null: no limit). */
export const appConfigSchema = z.object({
  minimumVersion: z.string().nullable(),
  /** Cloudflare Turnstile site key; null when sign-in needs no challenge. */
  turnstileSiteKey: z.string().nullable().default(null)
})

export type AppConfig = z.infer<typeof appConfigSchema>

/** "1.2.3", "v1.2.3" or "1.2.3-beta" as [1, 2, 3]; null when it is not a version. A suffix such as -beta is ignored. */
export function parseVersion(version: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/**
 * True when `current` is older than `minimum`. Anything that is not a version answers false, so a typo in the setting
 * can never lock people out of the app.
 */
export function isOlderVersion(current: string, minimum: string | null | undefined): boolean {
  if (!minimum) return false
  const a = parseVersion(current)
  const b = parseVersion(minimum)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!
  }
  return false
}
