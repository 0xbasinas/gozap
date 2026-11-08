import { describeDevice, SIGN_IN_ACTIVITY_LIMIT, type SignIn } from '@repo/shared'
import { and, desc, eq, lt } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { EmailMessage } from './email'

/** Sign-ins older than this are removed by the daily job. */
export const SIGN_IN_KEEP_DAYS = 90

export interface RecordedSignIn {
  label: string
  newDevice: boolean
}

/**
 * Remember a sign-in. It is "new" when the account has signed in before, but never with this browser and system
 * (the first sign-in of an account is not a surprise, so it never counts as new).
 */
export async function recordSignIn(
  db: Db,
  input: { userId: string; ipAddress: string | null; userAgent: string | null; now: number }
): Promise<RecordedSignIn> {
  const label = describeDevice(input.userAgent)
  const [anyBefore] = await db
    .select({ id: schema.signInEvent.id })
    .from(schema.signInEvent)
    .where(eq(schema.signInEvent.userId, input.userId))
    .limit(1)
  const [sameBefore] = anyBefore
    ? await db
        .select({ id: schema.signInEvent.id })
        .from(schema.signInEvent)
        .where(
          and(eq(schema.signInEvent.userId, input.userId), eq(schema.signInEvent.label, label))
        )
        .limit(1)
    : []
  const newDevice = anyBefore !== undefined && sameBefore === undefined
  await db.insert(schema.signInEvent).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    at: input.now,
    label,
    ipAddress: input.ipAddress,
    newDevice
  })
  return { label, newDevice }
}

/** The person's most recent sign-ins, newest first. */
export async function recentSignIns(db: Db, userId: string): Promise<SignIn[]> {
  const rows = await db
    .select()
    .from(schema.signInEvent)
    .where(eq(schema.signInEvent.userId, userId))
    .orderBy(desc(schema.signInEvent.at))
    .limit(SIGN_IN_ACTIVITY_LIMIT)
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    label: r.label,
    ipAddress: r.ipAddress,
    newDevice: r.newDevice
  }))
}

/** Remove sign-ins past the keep period (called by the daily job). */
export async function pruneSignIns(db: Db, now: number): Promise<void> {
  await db
    .delete(schema.signInEvent)
    .where(lt(schema.signInEvent.at, now - SIGN_IN_KEEP_DAYS * 86_400_000))
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Sent when an account signs in from a browser and system it has not used before. */
export function newDeviceEmail(
  appName: string,
  label: string,
  ipAddress: string | null,
  at: number
): Omit<EmailMessage, 'to'> {
  const when = new Date(at).toUTCString()
  const where = ipAddress ? ` (IP address ${ipAddress})` : ''
  return {
    subject: `New sign-in to your ${appName} account`,
    text: [
      `Your ${appName} account was signed in to from a new device: ${label}${where}.`,
      `Time: ${when}.`,
      '',
      'If this was you, nothing more to do. If it was not, open your account page, sign out everywhere, and remove any devices you do not know.'
    ].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">New sign-in to your account</h1>
<p>Your ${escape(appName)} account was signed in to from a new device: <strong>${escape(label)}</strong>${escape(where)}.<br>Time: ${escape(when)}.</p>
<p style="font-size:14px;color:#52525b">If this was you, nothing more to do. If it was not, open your account page, sign out everywhere, and remove any devices you do not know.</p>
</body></html>`
  }
}
