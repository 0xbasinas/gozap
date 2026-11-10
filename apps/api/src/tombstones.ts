import { and, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

export const TOMBSTONE_KEEP_DAYS = 90

async function hashFor(organizationId: string, email: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${organizationId}:${email.trim().toLowerCase()}`)
  )
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Inserts to run just before a person's account is deleted: one block per team whose directory lists them. */
export async function tombstoneStatements(db: Db, userId: string, now = Date.now()) {
  const rows = await db
    .select({ organizationId: schema.scimConnection.organizationId, email: schema.user.email })
    .from(schema.scimUser)
    .innerJoin(schema.scimConnection, eq(schema.scimConnection.id, schema.scimUser.connectionId))
    .innerJoin(schema.user, eq(schema.user.id, schema.scimUser.userId))
    .where(eq(schema.scimUser.userId, userId))
  const seen = new Set<string>()
  const statements = []
  for (const row of rows) {
    if (seen.has(row.organizationId)) continue
    seen.add(row.organizationId)
    statements.push(
      db
        .insert(schema.scimTombstone)
        .values({
          id: crypto.randomUUID(),
          organizationId: row.organizationId,
          emailHash: await hashFor(row.organizationId, row.email),
          createdAt: now
        })
        .onConflictDoNothing()
    )
  }
  return statements
}

export async function isTombstoned(
  db: Db,
  organizationId: string,
  email: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.scimTombstone.id })
    .from(schema.scimTombstone)
    .where(
      and(
        eq(schema.scimTombstone.organizationId, organizationId),
        eq(schema.scimTombstone.emailHash, await hashFor(organizationId, email))
      )
    )
  return Boolean(row)
}

export async function clearTombstones(db: Db, organizationId: string): Promise<void> {
  await db
    .delete(schema.scimTombstone)
    .where(eq(schema.scimTombstone.organizationId, organizationId))
}

export async function countTombstones(
  db: Db,
  organizationIds: string[]
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (organizationIds.length === 0) return out
  const rows = await db
    .select({ organizationId: schema.scimTombstone.organizationId })
    .from(schema.scimTombstone)
    .where(inArray(schema.scimTombstone.organizationId, organizationIds))
  for (const r of rows) out.set(r.organizationId, (out.get(r.organizationId) ?? 0) + 1)
  return out
}

export async function pruneTombstones(db: Db, now: number): Promise<void> {
  await db
    .delete(schema.scimTombstone)
    .where(lt(schema.scimTombstone.createdAt, now - TOMBSTONE_KEEP_DAYS * 86_400_000))
}
