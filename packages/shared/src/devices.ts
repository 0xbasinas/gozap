import { z } from 'zod'

export const DEVICE_NICKNAME_MAX = 40

/** A place you are signed in (one session), as the person sees it. */
export const deviceSchema = z.object({
  /** Opaque id for renaming or signing out that device. It is not the session token. */
  id: z.string(),
  /** "Chrome on Windows", "Desktop app on macOS" ... worked out from the user agent. */
  label: z.string(),
  /** The name the person gave it, if any ("Work laptop"). */
  nickname: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string(),
  current: z.boolean()
})

export const devicesSchema = z.array(deviceSchema)

/** `null` (or an empty name) removes the nickname. */
export const renameDeviceInputSchema = z.object({
  nickname: z.string().trim().max(DEVICE_NICKNAME_MAX).nullable()
})

export type Device = z.infer<typeof deviceSchema>

const OSES: [RegExp, string][] = [
  [/windows/i, 'Windows'],
  [/android/i, 'Android'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/macintosh|mac os x/i, 'macOS'],
  [/cros/i, 'ChromeOS'],
  [/linux|x11/i, 'Linux']
]

// Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
const APPS: [RegExp, string][] = [
  [/electron\//i, 'Desktop app'],
  [/edg(e|a|ios)?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/firefox|fxios/i, 'Firefox'],
  [/chrome|crios|chromium/i, 'Chrome'],
  [/safari/i, 'Safari']
]

/** A short, readable name for a user agent string, like "Chrome on Windows". Falls back to "Unknown device". */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const app = APPS.find(([pattern]) => pattern.test(userAgent))?.[1]
  const os = OSES.find(([pattern]) => pattern.test(userAgent))?.[1]
  if (app && os) return `${app} on ${os}`
  return app ?? os ?? 'Unknown device'
}
