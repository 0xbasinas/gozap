import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Db } from './db'
import { schema } from './db'

// Sending to addresses that bounce or complain damages the reputation of the sending domain, and then even good
// emails land in spam. Resend tells us through a webhook; we remember the address and stop trying for a while.
// (Resend keeps its own suppression list too; this also keeps the Worker from calling it for nothing.)

/** After this long we try again: mailboxes get fixed, and a wrong entry must not lock a person out for ever. */
export const SUPPRESSION_DAYS = 30
const DAY = 86_400_000

export type SuppressionReason = 'bounced' | 'complained'
export interface Suppression {
  address: string
  reason: SuppressionReason
}

const eventSchema = z.object({
  type: z.string(),
  data: z.object({
    to: z.array(z.string()).default([]),
    bounce: z.object({ type: z.string().optional() }).optional()
  })
})

/**
 * Which addresses should stop receiving mail because of this Resend event? Only a permanent bounce or a spam
 * complaint counts: a full mailbox or a temporary failure (transient bounce, delay) says nothing about the address.
 */
export function suppressionsFrom(payload: unknown): Suppression[] {
  const parsed = eventSchema.safeParse(payload)
  if (!parsed.success) return []
  const { type, data } = parsed.data
  let reason: SuppressionReason | null = null
  if (type === 'email.complained') reason = 'complained'
  if (type === 'email.bounced' && data.bounce?.type?.toLowerCase() === 'permanent')
    reason = 'bounced'
  if (!reason) return []
  return data.to
    .map((a) => a.trim().toLowerCase())
    .filter((a) => a.includes('@') && a.length <= 254)
    .map((address) => ({ address, reason }))
}

export async function suppress(db: Db, items: Suppression[], now = Date.now()): Promise<void> {
  for (const { address, reason } of items) {
    await db
      .insert(schema.emailSuppression)
      .values({ email: address, reason, createdAt: now })
      .onConflictDoUpdate({
        target: schema.emailSuppression.email,
        set: { reason, createdAt: now }
      })
  }
}

export async function isSuppressed(db: Db, address: string, now = Date.now()): Promise<boolean> {
  const [row] = await db
    .select()
    .from(schema.emailSuppression)
    .where(eq(schema.emailSuppression.email, address.trim().toLowerCase()))
  return row !== undefined && row.createdAt > now - SUPPRESSION_DAYS * DAY
}
