import { and, count, eq, inArray, ne, or, sql, type SQL } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import { revokeAppAccessStatements } from './oauthPrune'
import { emailInDomains } from './domains'
import { isTombstoned } from './tombstones'
import {
  accountEmail,
  emailValuesOf,
  hashToken,
  LAST_USED_WRITE_MS,
  parseScopes,
  ScimError,
  type FilterTerm,
  type GroupInput,
  type ScimScope,
  type UserRecord
} from './scim'
import type { AuditType } from './audit'
import { MAX_MEMBERS_PER_TEAM } from './teams'

export interface Connection {
  id: string
  organizationId: string
}

/** What happened to a person, for the audit trail. */
export interface ScimEvent {
  type: AuditType
  userId: string
}

type Statement = { execute?: unknown }
/** D1 runs a batch as one transaction. The typed overload wants a tuple, so this takes a plain list. */
async function batch(db: Db, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return
  try {
    await (db as unknown as { batch(s: Statement[]): Promise<unknown> }).batch(statements)
  } catch (error) {
    if (/UNIQUE|constraint/i.test(String(error)))
      throw new ScimError(
        409,
        'uniqueness',
        'That userName, externalId or displayName is already used.'
      )
    throw error
  }
}

// ---------------------------------------------------------------- authentication

/** The connection and scopes a bearer token grants, or null (unknown, revoked or expired). */
export async function authenticate(
  db: Db,
  secret: string,
  header: string | undefined,
  now: number
): Promise<{ connection: Connection; scopes: ScimScope[] } | null> {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '')
  if (!match) return null
  const hash = await hashToken(secret, match[1]!)
  const [row] = await db
    .select({
      credentialId: schema.scimCredential.id,
      scopes: schema.scimCredential.scopes,
      expiresAt: schema.scimCredential.expiresAt,
      revokedAt: schema.scimCredential.revokedAt,
      lastUsedAt: schema.scimCredential.lastUsedAt,
      connectionId: schema.scimConnection.id,
      organizationId: schema.scimConnection.organizationId
    })
    .from(schema.scimCredential)
    .innerJoin(
      schema.scimConnection,
      eq(schema.scimConnection.id, schema.scimCredential.connectionId)
    )
    .where(eq(schema.scimCredential.hash, hash))
  if (!row || row.revokedAt !== null || row.expiresAt <= now) return null
  if (row.lastUsedAt === null || now - row.lastUsedAt > LAST_USED_WRITE_MS)
    await db
      .update(schema.scimCredential)
      .set({ lastUsedAt: now })
      .where(eq(schema.scimCredential.id, row.credentialId))
  return {
    connection: { id: row.connectionId, organizationId: row.organizationId },
    scopes: parseScopes(row.scopes)
  }
}

// ---------------------------------------------------------------- users

export type UserRow = typeof schema.scimUser.$inferSelect

export function recordOf(row: UserRow): UserRecord {
  const stored = JSON.parse(row.data) as UserRecord
  return { ...stored, userName: row.userName, externalId: row.externalId, active: row.active }
}

const dataOf = (record: UserRecord): string => JSON.stringify(record)

export async function getUserRow(db: Db, conn: Connection, id: string): Promise<UserRow> {
  const [row] = await db
    .select()
    .from(schema.scimUser)
    .where(and(eq(schema.scimUser.id, id), eq(schema.scimUser.connectionId, conn.id)))
  if (!row) throw new ScimError(404, undefined, 'User not found.')
  return row
}

export async function listUsers(
  db: Db,
  conn: Connection,
  terms: FilterTerm[],
  start: number,
  limit: number
): Promise<{ rows: UserRow[]; total: number }> {
  const where: SQL[] = [eq(schema.scimUser.connectionId, conn.id)]
  for (const t of terms) {
    if (t.attr === 'id') where.push(eq(schema.scimUser.id, t.value))
    else if (t.attr === 'username')
      where.push(eq(schema.scimUser.userNameLower, t.value.toLowerCase()))
    else if (t.attr === 'externalid') where.push(eq(schema.scimUser.externalId, t.value))
    else if (t.attr === 'emails.value')
      where.push(
        sql`instr(${schema.scimUser.emailValues}, ${JSON.stringify(t.value.toLowerCase())}) > 0`
      )
  }
  const [total] = await db
    .select({ n: count() })
    .from(schema.scimUser)
    .where(and(...where))
  const rows =
    limit === 0
      ? []
      : await db
          .select()
          .from(schema.scimUser)
          .where(and(...where))
          .orderBy(schema.scimUser.createdAt, schema.scimUser.id)
          .limit(limit)
          .offset(start - 1)
  const typed = terms.filter((t) => t.type)
  const kept = typed.length
    ? rows.filter((row) =>
        typed.every((t) =>
          recordOf(row).emails.some(
            (e) =>
              e.type?.toLowerCase() === t.type && e.value.toLowerCase() === t.value.toLowerCase()
          )
        )
      )
    : rows
  return { rows: kept, total: total?.n ?? 0 }
}

async function teamHasRoom(db: Db, organizationId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(eq(schema.member.organizationId, organizationId))
  return (row?.n ?? 0) < MAX_MEMBERS_PER_TEAM
}

/**
 * A directory may create, adopt or re-address a sign-in account only at a domain this team has proven by DNS.
 * Without this, anyone who can start a team could provision (or rewrite) accounts for strangers' addresses.
 */
async function mayLink(db: Db, organizationId: string, email: string): Promise<boolean> {
  const providers = await db
    .select({ domain: schema.ssoProvider.domain })
    .from(schema.ssoProvider)
    .where(
      and(
        eq(schema.ssoProvider.organizationId, organizationId),
        eq(schema.ssoProvider.domainVerified, true)
      )
    )
  return providers.some((p) => emailInDomains(email, p.domain))
}

/** Take the person out of the team. A person who only existed because of the directory is also suspended. */
async function deactivation(db: Db, conn: Connection, row: UserRow): Promise<Statement[]> {
  const [seat] = await db
    .select({ role: schema.member.role })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, conn.organizationId),
        eq(schema.member.userId, row.userId)
      )
    )
  // Whoever the directory switched off also loses the company sign-in link on their account, so the identity provider
  // cannot sign them back in as that account. (The same rule is checked when a link is made: ssoLinkRefusal.) An
  // owner is never touched, and never removed by a directory: that would leave the team without anyone able to run it.
  if (seat?.role.includes('owner')) return []
  const unlink = db
    .delete(schema.account)
    .where(
      and(
        eq(schema.account.userId, row.userId),
        inArray(
          schema.account.providerId,
          db
            .select({ id: schema.ssoProvider.providerId })
            .from(schema.ssoProvider)
            .where(eq(schema.ssoProvider.organizationId, conn.organizationId))
        )
      )
    )
  if (!seat) return [unlink]
  const [others] = await db
    .select({ n: count() })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.userId, row.userId),
        ne(schema.member.organizationId, conn.organizationId)
      )
    )
  const [person] = await db
    .select({ role: schema.user.role })
    .from(schema.user)
    .where(eq(schema.user.id, row.userId))
  const statements: Statement[] = [
    unlink,
    db
      .delete(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, conn.organizationId),
          eq(schema.member.userId, row.userId)
        )
      )
  ]
  if (
    row.createdAccount &&
    (others?.n ?? 0) === 0 &&
    person?.role !== 'admin' &&
    person?.role !== 'support'
  ) {
    statements.push(
      db
        .update(schema.user)
        .set({ banned: true, banReason: 'deprovisioned', banExpires: null })
        .where(eq(schema.user.id, row.userId)),
      db.delete(schema.session).where(eq(schema.session.userId, row.userId)),
      ...revokeAppAccessStatements(db, row.userId)
    )
  }
  return statements
}

async function activation(
  db: Db,
  conn: Connection,
  row: UserRow,
  now: number
): Promise<Statement[]> {
  const [seat] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(
      and(
        eq(schema.member.organizationId, conn.organizationId),
        eq(schema.member.userId, row.userId)
      )
    )
  const statements: Statement[] = []
  if (!seat) {
    if (!(await teamHasRoom(db, conn.organizationId)))
      throw new ScimError(409, undefined, 'The team has the most members allowed.')
    statements.push(
      db.insert(schema.member).values({
        id: crypto.randomUUID(),
        organizationId: conn.organizationId,
        userId: row.userId,
        role: 'member',
        createdAt: new Date(now)
      })
    )
  }
  statements.push(
    db
      .update(schema.user)
      .set({ banned: false, banReason: null, banExpires: null })
      .where(and(eq(schema.user.id, row.userId), eq(schema.user.banReason, 'deprovisioned')))
  )
  return statements
}

export async function createUser(
  db: Db,
  conn: Connection,
  record: UserRecord,
  now: number
): Promise<{ row: UserRow; events: ScimEvent[] }> {
  const [sameName] = await db
    .select({ id: schema.scimUser.id })
    .from(schema.scimUser)
    .where(
      and(
        eq(schema.scimUser.connectionId, conn.id),
        eq(schema.scimUser.userNameLower, record.userName.toLowerCase())
      )
    )
  if (sameName) throw new ScimError(409, 'uniqueness', 'That userName is already used.')
  if (record.externalId) {
    const [same] = await db
      .select()
      .from(schema.scimUser)
      .where(
        and(
          eq(schema.scimUser.connectionId, conn.id),
          eq(schema.scimUser.externalId, record.externalId)
        )
      )
    // The same person coming back (Okta recreates a person it deactivated): keep their identity.
    if (same && !same.active) return saveUser(db, conn, same, { ...record, active: true }, now)
    if (same) throw new ScimError(409, 'uniqueness', 'That externalId is already used.')
  }
  const email = accountEmail(record)
  if (!(await mayLink(db, conn.organizationId, email)))
    throw new ScimError(
      403,
      undefined,
      'That email address is not at a domain this team has proven. Add the company sign-in and verify its domain first.'
    )
  const [existing] = await db
    .select({ id: schema.user.id })
    .from(schema.user)
    .where(eq(schema.user.email, email))
  if (existing) {
    const [linked] = await db
      .select({ id: schema.scimUser.id })
      .from(schema.scimUser)
      .where(
        and(eq(schema.scimUser.connectionId, conn.id), eq(schema.scimUser.userId, existing.id))
      )
    if (linked)
      throw new ScimError(409, 'uniqueness', 'An account with this email address already exists.')
  }
  if (!existing && (await isTombstoned(db, conn.organizationId, email)))
    throw new ScimError(
      409,
      undefined,
      'This person deleted their account. A team owner must allow it again before the directory can recreate it.'
    )
  if (record.active && !(await teamHasRoom(db, conn.organizationId)))
    throw new ScimError(409, undefined, 'The team has the most members allowed.')

  const userId = existing?.id ?? crypto.randomUUID()
  const row: UserRow = {
    id: crypto.randomUUID(),
    connectionId: conn.id,
    userId,
    createdAccount: !existing,
    grantedAdmin: false,
    userName: record.userName,
    userNameLower: record.userName.toLowerCase(),
    externalId: record.externalId,
    active: record.active,
    emailValues: emailValuesOf(record),
    data: dataOf(record),
    createdAt: now,
    updatedAt: now
  }
  const statements: Statement[] = []
  if (!existing)
    statements.push(
      db.insert(schema.user).values({
        id: userId,
        name: record.displayName ?? email,
        email,
        emailVerified: false,
        createdAt: new Date(now),
        updatedAt: new Date(now)
      })
    )
  statements.push(db.insert(schema.scimUser).values(row))
  if (record.active) {
    const [seat] = existing
      ? await db
          .select({ id: schema.member.id })
          .from(schema.member)
          .where(
            and(
              eq(schema.member.organizationId, conn.organizationId),
              eq(schema.member.userId, userId)
            )
          )
      : []
    if (!seat)
      statements.push(
        db.insert(schema.member).values({
          id: crypto.randomUUID(),
          organizationId: conn.organizationId,
          userId,
          role: 'member',
          createdAt: new Date(now)
        })
      )
  }
  await batch(db, statements)
  return { row, events: [{ type: 'scim_user_provisioned', userId }] }
}

/** Store a changed person: sign-in account details, team membership (on activation changes) and the record. */
export async function saveUser(
  db: Db,
  conn: Connection,
  row: UserRow,
  next: UserRecord,
  now: number
): Promise<{ row: UserRow; events: ScimEvent[] }> {
  const prev = recordOf(row)
  if (next.userName.toLowerCase() !== row.userNameLower) {
    const [taken] = await db
      .select({ id: schema.scimUser.id })
      .from(schema.scimUser)
      .where(
        and(
          eq(schema.scimUser.connectionId, conn.id),
          eq(schema.scimUser.userNameLower, next.userName.toLowerCase()),
          ne(schema.scimUser.id, row.id)
        )
      )
    if (taken) throw new ScimError(409, 'uniqueness', 'That userName is already used.')
  }
  if (next.externalId && next.externalId !== row.externalId) {
    const [taken] = await db
      .select({ id: schema.scimUser.id })
      .from(schema.scimUser)
      .where(
        and(
          eq(schema.scimUser.connectionId, conn.id),
          eq(schema.scimUser.externalId, next.externalId),
          ne(schema.scimUser.id, row.id)
        )
      )
    if (taken) throw new ScimError(409, 'uniqueness', 'That externalId is already used.')
  }
  const statements: Statement[] = []
  const email = accountEmail(next)
  if (email !== accountEmail(prev)) {
    if (!(await mayLink(db, conn.organizationId, email)))
      throw new ScimError(
        403,
        undefined,
        'That email address is not at a domain this team has proven.'
      )
    const [taken] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(and(eq(schema.user.email, email), ne(schema.user.id, row.userId)))
    if (taken)
      throw new ScimError(409, 'uniqueness', 'An account with this email address already exists.')
    // A new address is not proven: the person confirms it by signing in with it.
    statements.push(
      db
        .update(schema.user)
        .set({
          email,
          emailVerified: false,
          name: next.displayName ?? email,
          updatedAt: new Date(now)
        })
        .where(eq(schema.user.id, row.userId)),
      // Whoever was signed in under the old address is signed out.
      db.delete(schema.session).where(eq(schema.session.userId, row.userId))
    )
  } else if (next.displayName && next.displayName !== prev.displayName) {
    statements.push(
      db
        .update(schema.user)
        .set({ name: next.displayName, updatedAt: new Date(now) })
        .where(eq(schema.user.id, row.userId))
    )
  }
  const events: ScimEvent[] = []
  if (prev.active && !next.active) {
    statements.push(...(await deactivation(db, conn, row)))
    events.push({ type: 'scim_user_deactivated', userId: row.userId })
  } else if (!prev.active && next.active) {
    statements.push(...(await activation(db, conn, row, now)))
    events.push({ type: 'scim_user_reactivated', userId: row.userId })
  }
  const updated: UserRow = {
    ...row,
    userName: next.userName,
    userNameLower: next.userName.toLowerCase(),
    externalId: next.externalId,
    active: next.active,
    emailValues: emailValuesOf(next),
    data: dataOf(next),
    updatedAt: now
  }
  statements.push(
    db
      .update(schema.scimUser)
      .set({
        userName: updated.userName,
        userNameLower: updated.userNameLower,
        externalId: updated.externalId,
        active: updated.active,
        emailValues: updated.emailValues,
        data: updated.data,
        updatedAt: now
      })
      .where(eq(schema.scimUser.id, row.id))
  )
  await batch(db, statements)
  return { row: updated, events }
}

/** Delete the directory's record. The sign-in account stays (the person may have other teams or data). */
export async function deleteUser(db: Db, conn: Connection, row: UserRow): Promise<ScimEvent[]> {
  const statements: Statement[] = row.active ? await deactivation(db, conn, row) : []
  statements.push(db.delete(schema.scimUser).where(eq(schema.scimUser.id, row.id)))
  await batch(db, statements)
  return [{ type: 'scim_user_deactivated', userId: row.userId }]
}

/** A person who was switched off in a directory must not come back into the team by signing in. */
export async function isDeprovisioned(
  db: Db,
  organizationId: string,
  userId: string
): Promise<boolean> {
  const [row] = await db
    .select({ id: schema.scimUser.id })
    .from(schema.scimUser)
    .innerJoin(schema.scimConnection, eq(schema.scimConnection.id, schema.scimUser.connectionId))
    .where(
      and(
        eq(schema.scimConnection.organizationId, organizationId),
        eq(schema.scimUser.userId, userId),
        eq(schema.scimUser.active, false)
      )
    )
  return Boolean(row)
}

/**
 * The rule for linking a company sign-in to an account, done by hand because the plugin's own check cannot run on D1
 * (no transactions). Called before the link (an `account` row of a team's provider) is made. Returns why it must be
 * refused, or null.
 *  - The directory switched this person off: no link (and deactivation removes an existing one).
 *  - The identity provider's subject is already the directory's `externalId` of someone else: no link, so a matching
 *    email alone can never attach an identity to another person's account.
 * A team with no directory, or a person the directory does not list, is not affected.
 */
export async function ssoLinkRefusal(
  db: Db,
  link: { providerId: string; userId: string; subject: string }
): Promise<'deprovisioned' | 'subject_taken' | null> {
  const [provider] = await db
    .select({ organizationId: schema.ssoProvider.organizationId })
    .from(schema.ssoProvider)
    .where(eq(schema.ssoProvider.providerId, link.providerId))
  if (!provider?.organizationId) return null
  const rows = await db
    .select({
      userId: schema.scimUser.userId,
      externalId: schema.scimUser.externalId,
      active: schema.scimUser.active
    })
    .from(schema.scimUser)
    .innerJoin(schema.scimConnection, eq(schema.scimConnection.id, schema.scimUser.connectionId))
    .where(
      and(
        eq(schema.scimConnection.organizationId, provider.organizationId),
        or(eq(schema.scimUser.userId, link.userId), eq(schema.scimUser.externalId, link.subject))
      )
    )
  if (rows.some((r) => r.userId === link.userId && !r.active)) return 'deprovisioned'
  if (rows.some((r) => r.externalId === link.subject && r.userId !== link.userId))
    return 'subject_taken'
  return null
}

// ---------------------------------------------------------------- groups

export type GroupRow = typeof schema.scimGroup.$inferSelect

export async function getGroupRow(db: Db, conn: Connection, id: string): Promise<GroupRow> {
  const [row] = await db
    .select()
    .from(schema.scimGroup)
    .where(and(eq(schema.scimGroup.id, id), eq(schema.scimGroup.connectionId, conn.id)))
  if (!row) throw new ScimError(404, undefined, 'Group not found.')
  return row
}

export async function listGroups(
  db: Db,
  conn: Connection,
  terms: FilterTerm[],
  start: number,
  limit: number
): Promise<{ rows: GroupRow[]; total: number }> {
  const where: SQL[] = [eq(schema.scimGroup.connectionId, conn.id)]
  for (const t of terms) {
    if (t.attr === 'id') where.push(eq(schema.scimGroup.id, t.value))
    else if (t.attr === 'displayname')
      where.push(eq(schema.scimGroup.displayNameLower, t.value.toLowerCase()))
    else if (t.attr === 'externalid') where.push(eq(schema.scimGroup.externalId, t.value))
  }
  const [total] = await db
    .select({ n: count() })
    .from(schema.scimGroup)
    .where(and(...where))
  const rows =
    limit === 0
      ? []
      : await db
          .select()
          .from(schema.scimGroup)
          .where(and(...where))
          .orderBy(schema.scimGroup.createdAt, schema.scimGroup.id)
          .limit(limit)
          .offset(start - 1)
  return { rows, total: total?.n ?? 0 }
}

/** The members of several groups at once: group id to users. */
export async function membersOf(
  db: Db,
  groupIds: string[]
): Promise<Map<string, { id: string; userName: string }[]>> {
  const map = new Map<string, { id: string; userName: string }[]>()
  if (groupIds.length === 0) return map
  const rows = await db
    .select({
      groupId: schema.scimGroupMember.groupId,
      id: schema.scimUser.id,
      userName: schema.scimUser.userName
    })
    .from(schema.scimGroupMember)
    .innerJoin(schema.scimUser, eq(schema.scimUser.id, schema.scimGroupMember.scimUserId))
    .where(inArray(schema.scimGroupMember.groupId, groupIds))
  for (const r of rows)
    map.set(r.groupId, [...(map.get(r.groupId) ?? []), { id: r.id, userName: r.userName }])
  return map
}

async function checkMembers(db: Db, conn: Connection, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += 50) {
    const rows = await db
      .select({ id: schema.scimUser.id })
      .from(schema.scimUser)
      .where(
        and(
          eq(schema.scimUser.connectionId, conn.id),
          inArray(schema.scimUser.id, ids.slice(i, i + 50))
        )
      )
    for (const r of rows) found.add(r.id)
  }
  if (ids.some((id) => !found.has(id)))
    throw new ScimError(400, 'invalidValue', 'A member is not a user of this directory.')
}

const memberInserts = (db: Db, groupId: string, ids: string[]): Statement[] => {
  const out: Statement[] = []
  for (let i = 0; i < ids.length; i += 40)
    out.push(
      db
        .insert(schema.scimGroupMember)
        .values(ids.slice(i, i + 40).map((scimUserId) => ({ groupId, scimUserId })))
    )
  return out
}

async function checkGroupNames(
  db: Db,
  conn: Connection,
  input: GroupInput,
  exceptId?: string
): Promise<void> {
  const same = await db
    .select({
      id: schema.scimGroup.id,
      externalId: schema.scimGroup.externalId,
      name: schema.scimGroup.displayNameLower
    })
    .from(schema.scimGroup)
    .where(eq(schema.scimGroup.connectionId, conn.id))
  for (const g of same) {
    if (g.id === exceptId) continue
    if (g.name === input.displayName.toLowerCase())
      throw new ScimError(409, 'uniqueness', 'That displayName is already used.')
    if (input.externalId && g.externalId === input.externalId)
      throw new ScimError(409, 'uniqueness', 'That externalId is already used.')
  }
}

export async function createGroup(
  db: Db,
  conn: Connection,
  input: GroupInput,
  now: number
): Promise<GroupRow> {
  await checkGroupNames(db, conn, input)
  await checkMembers(db, conn, input.members)
  const row: GroupRow = {
    id: crypto.randomUUID(),
    connectionId: conn.id,
    displayName: input.displayName,
    displayNameLower: input.displayName.toLowerCase(),
    externalId: input.externalId,
    grantsAdmin: false,
    createdAt: now,
    updatedAt: now
  }
  await batch(db, [
    db.insert(schema.scimGroup).values(row),
    ...memberInserts(db, row.id, input.members)
  ])
  return row
}

export async function memberIdsOf(db: Db, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ id: schema.scimGroupMember.scimUserId })
    .from(schema.scimGroupMember)
    .where(eq(schema.scimGroupMember.groupId, groupId))
  return rows.map((r) => r.id)
}

/** Replace a group's name and its whole membership. */
export async function saveGroup(
  db: Db,
  conn: Connection,
  row: GroupRow,
  input: GroupInput,
  now: number
): Promise<GroupRow> {
  await checkGroupNames(db, conn, input, row.id)
  await checkMembers(db, conn, input.members)
  const updated: GroupRow = {
    ...row,
    displayName: input.displayName,
    displayNameLower: input.displayName.toLowerCase(),
    externalId: input.externalId,
    updatedAt: now
  }
  await batch(db, [
    db
      .update(schema.scimGroup)
      .set({
        displayName: updated.displayName,
        displayNameLower: updated.displayNameLower,
        externalId: updated.externalId,
        updatedAt: now
      })
      .where(eq(schema.scimGroup.id, row.id)),
    db.delete(schema.scimGroupMember).where(eq(schema.scimGroupMember.groupId, row.id)),
    ...memberInserts(db, row.id, input.members)
  ])
  return updated
}

export async function deleteGroup(db: Db, row: GroupRow): Promise<void> {
  await batch(db, [db.delete(schema.scimGroup).where(eq(schema.scimGroup.id, row.id))])
}

/**
 * Team admin rights that follow directory groups. A team owner marks a group as one that grants admin; people in such
 * a group become admins, and lose it again when they leave (only if the group gave it to them). Owners are never
 * touched, and nothing here can make anyone an owner.
 */
export async function syncRoles(
  db: Db,
  conn: Connection,
  scimUserIds: string[]
): Promise<ScimEvent[]> {
  const events: ScimEvent[] = []
  for (const id of [...new Set(scimUserIds)]) {
    const [row] = await db
      .select()
      .from(schema.scimUser)
      .where(and(eq(schema.scimUser.id, id), eq(schema.scimUser.connectionId, conn.id)))
    if (!row) continue
    const [seat] = await db
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, conn.organizationId),
          eq(schema.member.userId, row.userId)
        )
      )
    if (!seat || seat.role === 'owner' || seat.role.split(',').includes('owner')) continue
    const [granting] = await db
      .select({ groupId: schema.scimGroupMember.groupId })
      .from(schema.scimGroupMember)
      .innerJoin(schema.scimGroup, eq(schema.scimGroup.id, schema.scimGroupMember.groupId))
      .where(
        and(eq(schema.scimGroupMember.scimUserId, row.id), eq(schema.scimGroup.grantsAdmin, true))
      )
    const wants = Boolean(granting) && row.active
    if (wants && seat.role === 'member') {
      await batch(db, [
        db.update(schema.member).set({ role: 'admin' }).where(eq(schema.member.id, seat.id)),
        db.update(schema.scimUser).set({ grantedAdmin: true }).where(eq(schema.scimUser.id, row.id))
      ])
      events.push({ type: 'scim_role_changed', userId: row.userId })
    } else if (!wants && row.grantedAdmin) {
      await batch(db, [
        ...(seat.role === 'admin'
          ? [db.update(schema.member).set({ role: 'member' }).where(eq(schema.member.id, seat.id))]
          : []),
        db
          .update(schema.scimUser)
          .set({ grantedAdmin: false })
          .where(eq(schema.scimUser.id, row.id))
      ])
      if (seat.role === 'admin') events.push({ type: 'scim_role_changed', userId: row.userId })
    }
  }
  return events
}

export async function setGroupGrantsAdmin(db: Db, row: GroupRow, grants: boolean): Promise<void> {
  await batch(db, [
    db.update(schema.scimGroup).set({ grantsAdmin: grants }).where(eq(schema.scimGroup.id, row.id))
  ])
}
