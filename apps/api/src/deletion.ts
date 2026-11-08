import { soloTeamsDeletion } from './teams'
import { deletionDate } from '@repo/shared'
import { and, eq, lte } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import { closeRequests, openRequest } from './dataRequests'
import type { EmailMessage } from './email'

// Deleting an account is a request first: the account stays for the cooling-off period (see DELETION_COOLING_OFF_DAYS),
// the person gets an email with a cancel link, and a daily job removes the accounts whose time has come.

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** SHA-256 of a cancel token, as stored. */
export async function hashToken(token: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
}

/** A fresh unguessable token (256 bits, URL-safe). */
export function newCancelToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '')
}

export interface DeletionRequest {
  scheduledFor: number
  /** The cancel token, only when this call created the request (asking twice must not send a second email or change the date). */
  token: string | null
}

/** Ask to delete an account. Asking again keeps the original date. */
export async function requestDeletion(
  db: Db,
  userId: string,
  now: number
): Promise<DeletionRequest> {
  const [existing] = await db
    .select({ scheduledFor: schema.accountDeletion.scheduledFor })
    .from(schema.accountDeletion)
    .where(eq(schema.accountDeletion.userId, userId))
  if (existing) return { scheduledFor: existing.scheduledFor, token: null }
  const token = newCancelToken()
  const scheduledFor = deletionDate(now)
  await db.insert(schema.accountDeletion).values({
    userId,
    requestedAt: now,
    scheduledFor,
    cancelTokenHash: await hashToken(token)
  })
  await openRequest(db, userId, 'deletion', 'processing', now)
  return { scheduledFor, token }
}

/** When the account will be removed, or null if deletion was not requested. */
export async function scheduledDeletion(db: Db, userId: string): Promise<number | null> {
  const [row] = await db
    .select({ scheduledFor: schema.accountDeletion.scheduledFor })
    .from(schema.accountDeletion)
    .where(eq(schema.accountDeletion.userId, userId))
  return row?.scheduledFor ?? null
}

export async function cancelDeletion(db: Db, userId: string): Promise<void> {
  await db.delete(schema.accountDeletion).where(eq(schema.accountDeletion.userId, userId))
  await closeRequests(db, userId, 'deletion', 'cancelled', Date.now())
}

/** Cancel with the token from the email. Returns false when the token matches nothing (wrong, used, or already cancelled). */
export async function cancelDeletionWithToken(db: Db, token: string): Promise<boolean> {
  const removed = await db
    .delete(schema.accountDeletion)
    .where(eq(schema.accountDeletion.cancelTokenHash, await hashToken(token)))
    .returning({ userId: schema.accountDeletion.userId })
  for (const { userId } of removed)
    await closeRequests(db, userId, 'deletion', 'cancelled', Date.now())
  return removed.length > 0
}

/**
 * Remove every account whose cooling-off period is over (at most `limit` per run, so one run stays small).
 * Sessions, passkeys, preferences, feedback and nicknames go with the user (ON DELETE CASCADE); unused sign-in links are removed too.
 * Returns how many accounts were removed.
 */
export async function deleteDueAccounts(
  db: Db,
  now: number,
  limit = 50,
  /** Called with the address after the account is gone, to tell the person it happened (the address is not kept). */
  notify?: (email: string) => Promise<void>
): Promise<number> {
  const due = await db
    .select({ userId: schema.accountDeletion.userId, email: schema.user.email })
    .from(schema.accountDeletion)
    .innerJoin(schema.user, eq(schema.user.id, schema.accountDeletion.userId))
    .where(lte(schema.accountDeletion.scheduledFor, now))
    .limit(limit)
  for (const { userId, email } of due) {
    await db.batch([
      db.delete(schema.verification).where(eq(schema.verification.identifier, email)),
      // Teams only this person belongs to would be left with nobody to reach them.
      soloTeamsDeletion(db, userId),
      // API keys point at the person without a foreign key, so they are removed here.
      db.delete(schema.apikey).where(eq(schema.apikey.referenceId, userId)),
      db.delete(schema.user).where(and(eq(schema.user.id, userId)))
    ])
    await closeRequests(db, userId, 'deletion', 'done', now)
    await notify?.(email).catch((error: unknown) =>
      console.error('Could not send the deleted notice', error)
    )
  }
  return due.length
}

const dateText = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  })

/** The email sent when deletion is requested: when it will happen and how to stop it. */
export function deletionEmail(
  appName: string,
  scheduledFor: number,
  cancelUrl: string
): Omit<EmailMessage, 'to'> {
  const when = dateText(scheduledFor)
  const text = [
    `Your ${appName} account will be deleted on ${when}`,
    '',
    `Someone asked to delete this account. Until ${when} nothing is removed, and you can change your mind:`,
    '',
    cancelUrl,
    '',
    `On ${when} your account, devices, settings and feedback are deleted for good.`,
    'If you did not ask for this, use the link above, then sign out everywhere from your account page.'
  ].join('\n')
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return {
    subject: `Your ${appName} account will be deleted on ${when}`,
    text,
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">Your account will be deleted on ${escape(when)}</h1>
<p>Someone asked to delete your ${escape(appName)} account. Until ${escape(when)} nothing is removed, and you can change your mind.</p>
<p><a href="${escape(cancelUrl)}" style="display:inline-block;padding:10px 18px;background:#18181b;color:#fff;border-radius:8px;text-decoration:none">Keep my account</a></p>
<p style="font-size:14px;color:#52525b">On ${escape(when)} your account, devices, settings and feedback are deleted for good. If you did not ask for this, use the button, then sign out everywhere from your account page.</p>
</body></html>`
  }
}

/** The last email: the account is gone, and nothing is kept. */
export function accountDeletedEmail(appName: string): Omit<EmailMessage, 'to'> {
  return {
    subject: `Your ${appName} account was deleted`,
    text: [
      `Your ${appName} account, devices, settings and feedback were deleted, as you asked.`,
      '',
      'This is the last email we send to this address.'
    ].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">Your account was deleted</h1>
<p>Your ${appName.replace(/[<>&"]/g, '')} account, devices, settings and feedback were deleted, as you asked.</p>
<p style="font-size:14px;color:#52525b">This is the last email we send to this address.</p>
</body></html>`
  }
}
