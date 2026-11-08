import {
  currentConsents,
  POLICY_VERSION,
  type ConsentEvent,
  type ConsentPurpose,
  type Consents
} from '@repo/shared'
import { desc, eq } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

// The consent ledger: an append-only list of what a person agreed to or withdrew, with the policy version and time.
// Entries are never changed; withdrawing adds a new entry. They go when the account goes (cascade) and are part of the
// account export. Nothing here is needed to sign in.

/** Record an answer. Repeating the current answer adds nothing, so the ledger only holds real changes. */
export async function recordConsent(
  db: Db,
  userId: string,
  purpose: ConsentPurpose,
  granted: boolean,
  now: number
): Promise<void> {
  const { current } = await listConsents(db, userId)
  if (current[purpose] === granted) return
  if (current[purpose] === undefined && !granted) return
  await db.insert(schema.consent).values({
    id: crypto.randomUUID(),
    userId,
    purpose,
    granted,
    policyVersion: POLICY_VERSION,
    at: now
  })
}

export async function listConsents(db: Db, userId: string): Promise<Consents> {
  const rows = await db
    .select()
    .from(schema.consent)
    .where(eq(schema.consent.userId, userId))
    .orderBy(desc(schema.consent.at), desc(schema.consent.id))
    .limit(200)
  const history: ConsentEvent[] = rows.map((r) => ({
    purpose: r.purpose as ConsentPurpose,
    granted: r.granted,
    policyVersion: r.policyVersion,
    at: new Date(r.at).toISOString()
  }))
  return { current: currentConsents(history), history }
}
