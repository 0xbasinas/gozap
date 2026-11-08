import { EMAIL_CHANGE_MINUTES } from '@repo/shared'
import { eq } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import { hashToken, newCancelToken } from './deletion'
import type { EmailMessage } from './email'

/** Asking again within this time is refused, so the form cannot be used to flood someone's inbox. */
export const EMAIL_CHANGE_COOLDOWN_MS = 60_000

export type EmailChangeRequest =
  | { status: 'sent'; token: string }
  /** The address belongs to someone already. The answer to the person is the same as for "sent", so addresses cannot be probed. */
  | { status: 'taken' }
  | { status: 'too-soon' }

/** Start a move to `newEmail`. Only one is pending at a time; a new request replaces the old one. */
export async function requestEmailChange(
  db: Db,
  userId: string,
  newEmail: string,
  now: number
): Promise<EmailChangeRequest> {
  const [pending] = await db
    .select({ requestedAt: schema.emailChange.requestedAt })
    .from(schema.emailChange)
    .where(eq(schema.emailChange.userId, userId))
  if (pending && now - pending.requestedAt < EMAIL_CHANGE_COOLDOWN_MS) return { status: 'too-soon' }

  const [owner] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, newEmail))
  if (owner) return { status: 'taken' }

  const token = newCancelToken()
  const row = {
    userId,
    newEmail,
    requestedAt: now,
    expiresAt: now + EMAIL_CHANGE_MINUTES * 60_000,
    tokenHash: await hashToken(token)
  }
  await db.insert(schema.emailChange).values(row).onConflictDoUpdate({
    target: schema.emailChange.userId,
    set: row
  })
  return { status: 'sent', token }
}

export interface EmailChanged {
  userId: string
  oldEmail: string
  newEmail: string
}

/** Finish the move with the token from the email. Null when the token is wrong, used, expired, or the address was taken meanwhile. */
export async function confirmEmailChange(
  db: Db,
  token: string,
  now: number
): Promise<EmailChanged | null> {
  const [pending] = await db
    .select()
    .from(schema.emailChange)
    .where(eq(schema.emailChange.tokenHash, await hashToken(token)))
  if (!pending) return null
  if (pending.expiresAt < now) {
    await db.delete(schema.emailChange).where(eq(schema.emailChange.userId, pending.userId))
    return null
  }
  const [current] = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, pending.userId))
  if (!current) return null
  try {
    await db.batch([
      // The new address is proven by the link that arrived there.
      db
        .update(schema.user)
        .set({ email: pending.newEmail, emailVerified: true })
        .where(eq(schema.user.id, pending.userId)),
      db.delete(schema.emailChange).where(eq(schema.emailChange.userId, pending.userId))
    ])
  } catch {
    // The address was taken after the request (the unique index refused it).
    await db.delete(schema.emailChange).where(eq(schema.emailChange.userId, pending.userId))
    return null
  }
  return { userId: pending.userId, oldEmail: current.email, newEmail: pending.newEmail }
}

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Sent to the new address: the link that proves it is theirs. */
export function confirmEmailMessage(appName: string, url: string): Omit<EmailMessage, 'to'> {
  return {
    subject: `Confirm your new ${appName} email address`,
    text: [
      `Confirm your new ${appName} email address`,
      '',
      `Open this link to use this address for your ${appName} account. It works once and expires in ${EMAIL_CHANGE_MINUTES} minutes:`,
      '',
      url,
      '',
      'If you did not ask for this, ignore this email and nothing changes.'
    ].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">Confirm your new email address</h1>
<p>Use this address for your ${escape(appName)} account. The link works once and expires in ${EMAIL_CHANGE_MINUTES} minutes.</p>
<p><a href="${escape(url)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none">Confirm this address</a></p>
<p style="font-size:14px;color:#52525b">If you did not ask for this, ignore this email and nothing changes.</p>
</body></html>`
  }
}

/** Sent to the old address once the change happened, so a takeover does not go unnoticed. */
export function emailChangedNotice(appName: string, newEmail: string): Omit<EmailMessage, 'to'> {
  return {
    subject: `Your ${appName} email address was changed`,
    text: [
      `The email address of your ${appName} account was changed to ${newEmail}.`,
      '',
      'If this was you, nothing more to do. If it was not, sign out everywhere from the account page and contact the people who run the app.'
    ].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">Your email address was changed</h1>
<p>The email address of your ${escape(appName)} account was changed to <strong>${escape(newEmail)}</strong>.</p>
<p style="font-size:14px;color:#52525b">If this was you, nothing more to do. If it was not, sign out everywhere from the account page and contact the people who run the app.</p>
</body></html>`
  }
}

/** The address a person asked to move to and has not confirmed yet (and whose link has not expired), or null. */
export async function pendingEmail(db: Db, userId: string, now: number): Promise<string | null> {
  const [row] = await db
    .select({ newEmail: schema.emailChange.newEmail, expiresAt: schema.emailChange.expiresAt })
    .from(schema.emailChange)
    .where(eq(schema.emailChange.userId, userId))
  return row && row.expiresAt >= now ? row.newEmail : null
}
