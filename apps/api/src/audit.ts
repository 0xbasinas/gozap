import { describeDevice } from '@repo/shared'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'

/** Events about nobody in particular (failed sign-ins) are removed sooner than the rest. */
export const AUDIT_ANONYMOUS_KEEP_DAYS = 30
export const AUDIT_KEEP_DAYS = 365
export const AUDIT_LIST_LIMIT = 50

export type AuditType =
  | 'user_signed_in'
  | 'user_sign_in_failed'
  | 'session_revoked'
  | 'all_sessions_revoked'
  | 'profile_updated'
  | 'email_changed'
  | 'passkey_added'
  | 'passkey_removed'
  | 'team_created'
  | 'team_deleted'
  | 'team_left'
  | 'member_invited'
  | 'invitation_accepted'
  | 'member_removed'
  | 'team_role_changed'
  | 'api_key_created'
  | 'api_key_deleted'
  | 'user_banned'
  | 'user_unbanned'
  | 'user_role_updated'
  | 'user_impersonated'
  | 'user_impersonated_stopped'
  | 'user_removed'

export interface AuditInput {
  type: AuditType
  outcome: 'success' | 'failure'
  userId: string | null
  actorId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  /** A short code such as INVALID_TOKEN. Never free text from a stranger. */
  code?: string
  now: number
}

/** Write one event. Callers run this in the background and must not let a failure break the request. */
export async function recordAudit(db: Db, input: AuditInput): Promise<void> {
  await db.insert(schema.auditEvent).values({
    id: crypto.randomUUID(),
    userId: input.userId,
    actorId: input.actorId ?? null,
    type: input.type,
    outcome: input.outcome,
    ipAddress: input.ipAddress ?? null,
    label: input.userAgent ? describeDevice(input.userAgent) : null,
    detail: input.code ? JSON.stringify({ code: input.code }) : null,
    at: input.now
  })
}

/** What an auth endpoint call looked like when it finished. */
export interface AuthCall {
  path: string
  /** The code of the error the endpoint returned, when it failed with one. */
  errorCode?: string
  failed: boolean
  /** Where a magic-link verify redirected. A failure redirects to a URL with `error=`. */
  location?: string | null
}

const BY_PATH: Record<string, AuditType> = {
  '/revoke-session': 'session_revoked',
  '/revoke-other-sessions': 'all_sessions_revoked',
  '/revoke-sessions': 'all_sessions_revoked',
  '/update-user': 'profile_updated',
  '/passkey/verify-registration': 'passkey_added',
  '/passkey/delete-passkey': 'passkey_removed',
  '/organization/create': 'team_created',
  '/organization/delete': 'team_deleted',
  '/organization/leave': 'team_left',
  '/organization/invite-member': 'member_invited',
  '/organization/accept-invitation': 'invitation_accepted',
  '/organization/remove-member': 'member_removed',
  '/organization/update-member-role': 'team_role_changed',
  '/api-key/create': 'api_key_created',
  '/api-key/delete': 'api_key_deleted',
  '/admin/ban-user': 'user_banned',
  '/admin/unban-user': 'user_unbanned',
  '/admin/set-role': 'user_role_updated',
  '/admin/impersonate-user': 'user_impersonated',
  '/admin/stop-impersonating': 'user_impersonated_stopped',
  '/admin/remove-user': 'user_removed'
}

/**
 * Decide what to record for a finished auth call (null: nothing). Sign-ins that work are recorded where the session
 * is created (databaseHooks), so only failures are handled here. A magic-link verify never throws: a bad link comes
 * back as a redirect with `error=` in it, so that is what we look at.
 */
export function eventForCall(call: AuthCall): Pick<AuditInput, 'type' | 'outcome' | 'code'> | null {
  if (call.path === '/magic-link/verify') {
    return call.failed || /[?&]error=/.test(call.location ?? '')
      ? { type: 'user_sign_in_failed', outcome: 'failure', code: call.errorCode ?? 'INVALID_TOKEN' }
      : null
  }
  if (call.path === '/passkey/verify-authentication') {
    return call.failed
      ? { type: 'user_sign_in_failed', outcome: 'failure', code: call.errorCode ?? 'PASSKEY' }
      : null
  }
  const type = BY_PATH[call.path]
  if (!type) return null
  // A call that failed changed nothing. The exception is a refused admin action, which is worth seeing.
  if (call.failed) {
    return call.path.startsWith('/admin/')
      ? { type, outcome: 'failure', code: call.errorCode ?? 'FAILED' }
      : null
  }
  return { type, outcome: 'success' }
}

export interface AuditEntry {
  at: string
  type: string
  outcome: string
  label: string | null
  ipAddress: string | null
}

/** The person's own events, newest first. */
export async function recentAudit(db: Db, userId: string): Promise<AuditEntry[]> {
  const rows = await db
    .select()
    .from(schema.auditEvent)
    .where(eq(schema.auditEvent.userId, userId))
    .orderBy(desc(schema.auditEvent.at))
    .limit(AUDIT_LIST_LIMIT)
  return rows.map((r) => ({
    at: new Date(r.at).toISOString(),
    type: r.type,
    outcome: r.outcome,
    label: r.label,
    ipAddress: r.ipAddress
  }))
}

/** Daily job: anonymous events after 30 days, everything else after a year. */
export async function pruneAudit(db: Db, now: number): Promise<void> {
  const day = 86_400_000
  await db
    .delete(schema.auditEvent)
    .where(
      and(
        isNull(schema.auditEvent.userId),
        lt(schema.auditEvent.at, now - AUDIT_ANONYMOUS_KEEP_DAYS * day)
      )
    )
  await db.delete(schema.auditEvent).where(lt(schema.auditEvent.at, now - AUDIT_KEEP_DAYS * day))
}
