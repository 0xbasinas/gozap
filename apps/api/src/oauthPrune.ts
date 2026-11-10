import { eq, lt } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

/** Daily clean-up: access tokens, refresh tokens and client assertions that have run out are of no use to anyone. */
export async function pruneOauth(db: Db, now: number): Promise<void> {
  const at = new Date(now)
  await db.delete(schema.oauthAccessToken).where(lt(schema.oauthAccessToken.expiresAt, at))
  await db.delete(schema.oauthRefreshToken).where(lt(schema.oauthRefreshToken.expiresAt, at))
  await db.delete(schema.deviceCode).where(lt(schema.deviceCode.expiresAt, at))
  await db.delete(schema.oauthClientAssertion).where(lt(schema.oauthClientAssertion.expiresAt, at))
}

/** The statements that cut every AI app off from one person's account (tokens and approvals). */
export function revokeAppAccessStatements(db: Db, userId: string) {
  return [
    db.delete(schema.oauthAccessToken).where(eq(schema.oauthAccessToken.userId, userId)),
    db.delete(schema.oauthRefreshToken).where(eq(schema.oauthRefreshToken.userId, userId)),
    db.delete(schema.oauthConsent).where(eq(schema.oauthConsent.userId, userId)),
    // Pending device approvals point at the person without a foreign key.
    db.delete(schema.deviceCode).where(eq(schema.deviceCode.userId, userId))
  ] as const
}

export async function revokeAppAccess(db: Db, userId: string): Promise<void> {
  await db.batch(revokeAppAccessStatements(db, userId))
}
