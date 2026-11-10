import { count, desc, eq } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

export interface AiAppRow {
  clientId: string
  name: string | null
  disabled: boolean
  /** How many people have approved the app. */
  people: number
  createdAt: string | null
}

/** Every AI app (OAuth client) that has asked for access, newest first. Staff only; the caller checks that. */
export async function listAiApps(db: Db): Promise<AiAppRow[]> {
  const rows = await db
    .select({
      clientId: schema.oauthClient.clientId,
      name: schema.oauthClient.name,
      disabled: schema.oauthClient.disabled,
      createdAt: schema.oauthClient.createdAt
    })
    .from(schema.oauthClient)
    .orderBy(desc(schema.oauthClient.createdAt))
    .limit(200)
  const approvals = await db
    .select({ clientId: schema.oauthConsent.clientId, n: count() })
    .from(schema.oauthConsent)
    .groupBy(schema.oauthConsent.clientId)
  const byClient = new Map(approvals.map((a) => [a.clientId, a.n]))
  return rows.map((r) => ({
    clientId: r.clientId,
    name: r.name,
    disabled: r.disabled === true,
    people: byClient.get(r.clientId) ?? 0,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null
  }))
}

/**
 * Switch one app off or on. Off means: it is refused at every endpoint (the plugin checks `disabled`), and every token,
 * approval and pending device code it holds is deleted, so switching it on again starts from nothing and each person
 * has to approve it again. One batch, because D1 has no transactions.
 */
export function setAiAppDisabledStatements(db: Db, clientId: string, disabled: boolean) {
  const update = db
    .update(schema.oauthClient)
    .set({ disabled, updatedAt: new Date() })
    .where(eq(schema.oauthClient.clientId, clientId))
  if (!disabled) return [update] as const
  return [
    update,
    db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.clientId, clientId)),
    db.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.clientId, clientId)),
    db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.clientId, clientId)),
    db.delete(schema.deviceCode).where(eq(schema.deviceCode.clientId, clientId))
  ] as const
}

/** Whether an app has been switched off. An app we have no row for is treated as off (nothing to trust). */
export async function isAiAppDisabled(db: Db, clientId: string): Promise<boolean> {
  const [row] = await db
    .select({ disabled: schema.oauthClient.disabled })
    .from(schema.oauthClient)
    .where(eq(schema.oauthClient.clientId, clientId))
  return !row || row.disabled === true
}
