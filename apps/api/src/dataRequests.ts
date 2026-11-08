import {
  dataRequestDeadline,
  type DataRequest,
  type DATA_REQUEST_KINDS,
  type DATA_REQUEST_STATUSES
} from '@repo/shared'
import { and, desc, eq, inArray, lt } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

type Kind = (typeof DATA_REQUEST_KINDS)[number]
type Status = (typeof DATA_REQUEST_STATUSES)[number]

// A log of requests about personal data (export, deletion) with a status and a deadline, so the answer can be shown to
// the person and proven later. It deliberately has no link to the user row and holds no email address: it must survive
// the account it is about, and what is left afterwards is only a random id, a kind, a status and dates. Rows are
// pruned a year after they were received.

/** How long finished requests stay in the log. */
export const DATA_REQUEST_KEEP_DAYS = 365

export async function openRequest(
  db: Db,
  userId: string,
  kind: Kind,
  status: Status,
  now: number
): Promise<void> {
  await db.insert(schema.dataRequest).values({
    id: crypto.randomUUID(),
    subjectId: userId,
    kind,
    status,
    receivedAt: now,
    dueAt: dataRequestDeadline(now),
    completedAt: status === 'done' ? now : null
  })
}

/** Finish the open requests of a kind for a person: done (it happened) or cancelled (they changed their mind). */
export async function closeRequests(
  db: Db,
  userId: string,
  kind: Kind,
  status: 'done' | 'cancelled',
  now: number
): Promise<void> {
  await db
    .update(schema.dataRequest)
    .set({ status, completedAt: now })
    .where(
      and(
        eq(schema.dataRequest.subjectId, userId),
        eq(schema.dataRequest.kind, kind),
        inArray(schema.dataRequest.status, ['received', 'processing'])
      )
    )
}

/** A person's requests, newest first. */
export async function listRequests(db: Db, userId: string): Promise<DataRequest[]> {
  const rows = await db
    .select()
    .from(schema.dataRequest)
    .where(eq(schema.dataRequest.subjectId, userId))
    .orderBy(desc(schema.dataRequest.receivedAt))
    .limit(50)
  return rows.map((r) => ({
    kind: r.kind as Kind,
    status: r.status as Status,
    receivedAt: new Date(r.receivedAt).toISOString(),
    dueAt: new Date(r.dueAt).toISOString(),
    completedAt: r.completedAt === null ? null : new Date(r.completedAt).toISOString()
  }))
}

/** Remove entries past the keep period (called by the daily job). */
export async function pruneRequests(db: Db, now: number): Promise<void> {
  await db
    .delete(schema.dataRequest)
    .where(lt(schema.dataRequest.receivedAt, now - DATA_REQUEST_KEEP_DAYS * 86_400_000))
}
