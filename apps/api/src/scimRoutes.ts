import { zValidator } from '@hono/zod-validator'
import * as Sentry from '@sentry/cloudflare'
import { and, count, eq, isNull, gt } from 'drizzle-orm'
import { Hono, type Context, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { recordAudit } from './audit'
import { clearTombstones, countTombstones } from './tombstones'
import { schema, type Db } from './db'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'
import {
  discovery,
  errorBody,
  groupFromBody,
  groupResource,
  listResponse,
  MAX_ACTIVE_CREDENTIALS,
  MAX_BODY_BYTES,
  MAX_CONNECTIONS_PER_TEAM,
  newToken,
  parseFilter,
  parsePaging,
  parsePatch,
  hashToken,
  patchGroup,
  patchUser,
  ScimError,
  SCOPES,
  selectAttributes,
  userFromBody,
  userResource,
  type ScimScope
} from './scim'
import {
  authenticate,
  createGroup,
  createUser,
  deleteGroup,
  deleteUser,
  getGroupRow,
  getUserRow,
  listGroups,
  listUsers,
  memberIdsOf,
  membersOf,
  recordOf,
  saveGroup,
  setGroupGrantsAdmin,
  syncRoles,
  saveUser,
  type Connection,
  type ScimEvent
} from './scimStore'

type ScimEnv = {
  Bindings: Bindings
  Variables: { db: Db; conn: Connection; scopes: ScimScope[] }
}
type Ctx = Context<ScimEnv>

const TYPE = 'application/scim+json; charset=utf-8'

const send = (c: Ctx, body: unknown, status: 200 | 201 | 204 = 200): Response =>
  status === 204
    ? c.body(null, 204)
    : c.body(JSON.stringify(body), status, { 'content-type': TYPE, 'cache-control': 'no-store' })

const base = (c: Ctx): string => `${new URL(c.req.url).origin}/api/scim/v2`

async function readJson(c: Ctx): Promise<unknown> {
  const length = Number(c.req.header('content-length') ?? 0)
  if (length > MAX_BODY_BYTES) throw new ScimError(413, 'invalidValue', 'The request is too large.')
  const text = await c.req.text()
  if (text.length > MAX_BODY_BYTES)
    throw new ScimError(413, 'invalidValue', 'The request is too large.')
  try {
    return JSON.parse(text)
  } catch {
    throw new ScimError(400, 'invalidSyntax', 'The body is not valid JSON.')
  }
}

function record(c: Ctx, events: ScimEvent[]): void {
  const now = Date.now()
  c.executionCtx.waitUntil(
    Promise.all(
      events.map((e) =>
        recordAudit(c.var.db, { type: e.type, outcome: 'success', userId: e.userId, now }).catch(
          (error: unknown) => Sentry.captureException(error)
        )
      )
    )
  )
}

const need =
  (scope: ScimScope): MiddlewareHandler<ScimEnv> =>
  async (c, next) => {
    if (!c.var.scopes.includes(scope))
      throw new ScimError(403, undefined, 'This token may not do that.')
    await next()
  }

const query = (
  c: Ctx
): {
  filter?: string
  startIndex?: string
  count?: string
  attributes?: string
  excludedAttributes?: string
} => c.req.query()

/** The SCIM 2.0 endpoints a company's directory calls, under /api/scim/v2. Bearer tokens made on the team page. */
export function createScimApi(): Hono<ScimEnv> {
  const api = new Hono<ScimEnv>()

  api.onError((error, c) => {
    if (error instanceof ScimError)
      return c.body(JSON.stringify(errorBody(error)), error.status as 400, { 'content-type': TYPE })
    console.error('SCIM error', error)
    Sentry.captureException(error)
    return c.body(
      JSON.stringify(errorBody(new ScimError(500, undefined, 'Something went wrong.'))),
      500,
      {
        'content-type': TYPE
      }
    )
  })
  api.notFound((c) =>
    c.body(JSON.stringify(errorBody(new ScimError(404, undefined, 'Not found.'))), 404, {
      'content-type': TYPE
    })
  )

  // Discovery is public, as the standard asks.
  const doc = (c: Ctx) => discovery(base(c))
  api.get('/ServiceProviderConfig', (c) => send(c, doc(c).config))
  api.get('/Schemas', (c) => {
    const all = doc(c).schemas
    return send(c, listResponse(all, all.length, 1))
  })
  api.get('/Schemas/:id', (c) => {
    const found = doc(c).schemas.find((s) => s.id === c.req.param('id'))
    if (!found) throw new ScimError(404, undefined, 'Schema not found.')
    return send(c, found)
  })
  api.get('/ResourceTypes', (c) => {
    const all = doc(c).resourceTypes
    return send(c, listResponse(all, all.length, 1))
  })
  api.get('/ResourceTypes/:id', (c) => {
    const found = doc(c).resourceTypes.find((s) => s.id === c.req.param('id'))
    if (!found) throw new ScimError(404, undefined, 'Resource type not found.')
    return send(c, found)
  })

  // Everything below needs a token.
  api.use('*', async (c, next) => {
    const found = await authenticate(
      c.var.db,
      c.env.BETTER_AUTH_SECRET,
      c.req.header('authorization'),
      Date.now()
    )
    if (!found) {
      c.header('www-authenticate', 'Bearer')
      throw new ScimError(401, undefined, 'The token is missing, expired or revoked.')
    }
    c.set('conn', found.connection)
    c.set('scopes', found.scopes)
    await next()
  })

  // ---- Users
  api.get('/Users', need('scim.users.read'), async (c) => {
    const q = query(c)
    const terms = parseFilter(q.filter, ['id', 'username', 'externalid', 'emails.value'])
    const page = parsePaging(q.startIndex, q.count)
    const { rows, total } = await listUsers(c.var.db, c.var.conn, terms, page.start, page.count)
    const resources = rows.map((row) =>
      selectAttributes(
        userResource(row, recordOf(row), base(c)),
        q.attributes,
        q.excludedAttributes
      )
    )
    return send(c, listResponse(resources, total, page.start))
  })
  api.get('/Users/:id', need('scim.users.read'), async (c) => {
    const row = await getUserRow(c.var.db, c.var.conn, c.req.param('id'))
    const q = query(c)
    return send(
      c,
      selectAttributes(
        userResource(row, recordOf(row), base(c)),
        q.attributes,
        q.excludedAttributes
      )
    )
  })
  api.post('/Users', need('scim.users.write'), async (c) => {
    const input = userFromBody(await readJson(c))
    const { row, events } = await createUser(c.var.db, c.var.conn, input, Date.now())
    record(c, events)
    c.header('location', `${base(c)}/Users/${row.id}`)
    return send(c, userResource(row, recordOf(row), base(c)), 201)
  })
  api.put('/Users/:id', need('scim.users.write'), async (c) => {
    const row = await getUserRow(c.var.db, c.var.conn, c.req.param('id'))
    const saved = await saveUser(
      c.var.db,
      c.var.conn,
      row,
      userFromBody(await readJson(c)),
      Date.now()
    )
    record(c, [...saved.events, ...(await syncRoles(c.var.db, c.var.conn, [row.id]))])
    return send(c, userResource(saved.row, recordOf(saved.row), base(c)))
  })
  api.patch('/Users/:id', need('scim.users.write'), async (c) => {
    const row = await getUserRow(c.var.db, c.var.conn, c.req.param('id'))
    const next = patchUser(recordOf(row), parsePatch(await readJson(c)))
    const saved = await saveUser(c.var.db, c.var.conn, row, next, Date.now())
    record(c, [...saved.events, ...(await syncRoles(c.var.db, c.var.conn, [row.id]))])
    return send(c, userResource(saved.row, recordOf(saved.row), base(c)))
  })
  api.delete('/Users/:id', need('scim.users.write'), async (c) => {
    const row = await getUserRow(c.var.db, c.var.conn, c.req.param('id'))
    record(c, await deleteUser(c.var.db, c.var.conn, row))
    return send(c, null, 204)
  })

  // ---- Groups
  const groupJson = async (c: Ctx, rows: Awaited<ReturnType<typeof listGroups>>['rows']) => {
    const members = await membersOf(
      c.var.db,
      rows.map((r) => r.id)
    )
    const q = query(c)
    return rows.map((row) =>
      selectAttributes(
        groupResource(row, members.get(row.id) ?? [], base(c)),
        q.attributes,
        q.excludedAttributes
      )
    )
  }
  api.get('/Groups', need('scim.groups.read'), async (c) => {
    const q = query(c)
    const terms = parseFilter(q.filter, ['id', 'displayname', 'externalid'])
    const page = parsePaging(q.startIndex, q.count)
    const { rows, total } = await listGroups(c.var.db, c.var.conn, terms, page.start, page.count)
    return send(c, listResponse(await groupJson(c, rows), total, page.start))
  })
  api.get('/Groups/:id', need('scim.groups.read'), async (c) => {
    const row = await getGroupRow(c.var.db, c.var.conn, c.req.param('id'))
    return send(c, (await groupJson(c, [row]))[0])
  })
  api.post('/Groups', need('scim.groups.write'), async (c) => {
    const row = await createGroup(
      c.var.db,
      c.var.conn,
      groupFromBody(await readJson(c), false),
      Date.now()
    )
    record(c, await syncRoles(c.var.db, c.var.conn, await memberIdsOf(c.var.db, row.id)))
    c.header('location', `${base(c)}/Groups/${row.id}`)
    return send(c, (await groupJson(c, [row]))[0], 201)
  })
  api.put('/Groups/:id', need('scim.groups.write'), async (c) => {
    const row = await getGroupRow(c.var.db, c.var.conn, c.req.param('id'))
    const before = await memberIdsOf(c.var.db, row.id)
    const saved = await saveGroup(
      c.var.db,
      c.var.conn,
      row,
      groupFromBody(await readJson(c), false),
      Date.now()
    )
    record(
      c,
      await syncRoles(c.var.db, c.var.conn, [...before, ...(await memberIdsOf(c.var.db, row.id))])
    )
    return send(c, (await groupJson(c, [saved]))[0])
  })
  api.patch('/Groups/:id', need('scim.groups.write'), async (c) => {
    const row = await getGroupRow(c.var.db, c.var.conn, c.req.param('id'))
    const current = {
      displayName: row.displayName,
      externalId: row.externalId,
      members: await memberIdsOf(c.var.db, row.id)
    }
    const next = patchGroup(current, parsePatch(await readJson(c)))
    const saved = await saveGroup(c.var.db, c.var.conn, row, next, Date.now())
    record(
      c,
      await syncRoles(c.var.db, c.var.conn, [
        ...current.members,
        ...(await memberIdsOf(c.var.db, row.id))
      ])
    )
    return send(c, (await groupJson(c, [saved]))[0])
  })
  api.delete('/Groups/:id', need('scim.groups.write'), async (c) => {
    const gone = await getGroupRow(c.var.db, c.var.conn, c.req.param('id'))
    const members = await memberIdsOf(c.var.db, gone.id)
    await deleteGroup(c.var.db, gone)
    record(c, await syncRoles(c.var.db, c.var.conn, members))
    return send(c, null, 204)
  })

  return api
}

// ---------------------------------------------------------------- management (team owners, signed in)

type AdminEnv = {
  Bindings: Bindings
  Variables: { db: Db; userId: string }
}

const createInput = z.object({
  organizationId: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(365).default(90)
})
const rotateInput = z.object({ expiresInDays: z.number().int().min(1).max(365).default(90) })

/** Team owners make and revoke the tokens a directory uses. Tokens are shown once. */
export function createScimAdmin(requireSession: MiddlewareHandler): Hono<AdminEnv> {
  const admin = new Hono<AdminEnv>()
  admin.use(sameOriginOnly)
  admin.use(requireSession)
  admin.use(async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  })

  type AdminCtx = Context<AdminEnv>
  const ownsTeam = async (c: AdminCtx, organizationId: string): Promise<void> => {
    const [seat] = await c.var.db
      .select({ role: schema.member.role })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, organizationId),
          eq(schema.member.userId, c.var.userId)
        )
      )
    if (!seat?.role.includes('owner'))
      throw new HTTPException(403, { message: 'Only the team owner can do that' })
  }
  const connectionFor = async (c: AdminCtx, id: string) => {
    const [row] = await c.var.db
      .select()
      .from(schema.scimConnection)
      .where(eq(schema.scimConnection.id, id))
    if (!row) throw new HTTPException(404, { message: 'Not found' })
    await ownsTeam(c, row.organizationId)
    return row
  }
  const audit = (
    c: AdminCtx,
    type:
      | 'scim_connection_created'
      | 'scim_connection_removed'
      | 'scim_token_created'
      | 'scim_token_revoked'
      | 'scim_group_role_on'
      | 'scim_group_role_off'
  ) =>
    c.executionCtx.waitUntil(
      recordAudit(c.var.db, {
        type,
        outcome: 'success',
        userId: c.var.userId,
        now: Date.now()
      }).catch((error: unknown) => Sentry.captureException(error))
    )
  const makeToken = async (c: AdminCtx, connectionId: string, days: number) => {
    const now = Date.now()
    const token = newToken()
    const id = crypto.randomUUID()
    const expiresAt = now + days * 86_400_000
    await c.var.db.insert(schema.scimCredential).values({
      id,
      connectionId,
      hash: await hashToken(c.env.BETTER_AUTH_SECRET, token),
      scopes: SCOPES.join(' '),
      expiresAt,
      createdAt: now
    })
    return { credentialId: id, token, expiresAt: new Date(expiresAt).toISOString() }
  }

  admin.get('/', async (c) => {
    const organizationId = c.req.query('organizationId') ?? ''
    await ownsTeam(c, organizationId)
    const connections = await c.var.db
      .select()
      .from(schema.scimConnection)
      .where(eq(schema.scimConnection.organizationId, organizationId))
    const blocked = await countTombstones(c.var.db, [organizationId])
    const out = []
    for (const conn of connections) {
      const credentials = await c.var.db
        .select({
          id: schema.scimCredential.id,
          expiresAt: schema.scimCredential.expiresAt,
          revokedAt: schema.scimCredential.revokedAt,
          lastUsedAt: schema.scimCredential.lastUsedAt,
          createdAt: schema.scimCredential.createdAt
        })
        .from(schema.scimCredential)
        .where(eq(schema.scimCredential.connectionId, conn.id))
      const [people] = await c.var.db
        .select({ n: count() })
        .from(schema.scimUser)
        .where(eq(schema.scimUser.connectionId, conn.id))
      out.push({
        id: conn.id,
        name: conn.name,
        createdAt: new Date(conn.createdAt).toISOString(),
        people: people?.n ?? 0,
        blocked: blocked.get(conn.organizationId) ?? 0,
        credentials: credentials.map((k) => ({
          id: k.id,
          expiresAt: new Date(k.expiresAt).toISOString(),
          revoked: k.revokedAt !== null,
          lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt).toISOString() : null
        }))
      })
    }
    return c.json({ baseUrl: `${new URL(c.req.url).origin}/api/scim/v2`, connections: out })
  })

  admin.post('/', zValidator('json', createInput), async (c) => {
    const { organizationId, name, expiresInDays } = c.req.valid('json')
    await ownsTeam(c, organizationId)
    const [existing] = await c.var.db
      .select({ n: count() })
      .from(schema.scimConnection)
      .where(eq(schema.scimConnection.organizationId, organizationId))
    if ((existing?.n ?? 0) >= MAX_CONNECTIONS_PER_TEAM)
      throw new HTTPException(400, {
        message: 'This team has the most directory connections allowed'
      })
    const id = crypto.randomUUID()
    await c.var.db.insert(schema.scimConnection).values({
      id,
      organizationId,
      name,
      createdBy: c.var.userId,
      createdAt: Date.now()
    })
    const made = await makeToken(c, id, expiresInDays)
    audit(c, 'scim_connection_created')
    return c.json({ id, ...made, baseUrl: `${new URL(c.req.url).origin}/api/scim/v2` }, 201)
  })

  admin.post('/:id/credentials', zValidator('json', rotateInput), async (c) => {
    const conn = await connectionFor(c, c.req.param('id'))
    const [active] = await c.var.db
      .select({ n: count() })
      .from(schema.scimCredential)
      .where(
        and(
          eq(schema.scimCredential.connectionId, conn.id),
          isNull(schema.scimCredential.revokedAt),
          gt(schema.scimCredential.expiresAt, Date.now())
        )
      )
    if ((active?.n ?? 0) >= MAX_ACTIVE_CREDENTIALS)
      throw new HTTPException(400, { message: 'Revoke an old token first' })
    const made = await makeToken(c, conn.id, c.req.valid('json').expiresInDays)
    audit(c, 'scim_token_created')
    return c.json(made, 201)
  })

  admin.delete('/:id/credentials/:credentialId', async (c) => {
    const conn = await connectionFor(c, c.req.param('id'))
    await c.var.db
      .update(schema.scimCredential)
      .set({ revokedAt: Date.now() })
      .where(
        and(
          eq(schema.scimCredential.id, c.req.param('credentialId')),
          eq(schema.scimCredential.connectionId, conn.id),
          isNull(schema.scimCredential.revokedAt)
        )
      )
    audit(c, 'scim_token_revoked')
    return c.body(null, 204)
  })

  // The groups a directory has pushed, with whether each one makes its people team admins.
  admin.get('/:id/groups', async (c) => {
    const conn = await connectionFor(c, c.req.param('id'))
    const rows = await c.var.db
      .select({
        id: schema.scimGroup.id,
        name: schema.scimGroup.displayName,
        grantsAdmin: schema.scimGroup.grantsAdmin
      })
      .from(schema.scimGroup)
      .where(eq(schema.scimGroup.connectionId, conn.id))
    return c.json({ groups: rows })
  })

  // Owners only (connectionFor checks): make a group grant team admin, or stop it. Never owner.
  admin.put(
    '/:id/groups/:groupId',
    zValidator('json', z.object({ grantsAdmin: z.boolean() })),
    async (c) => {
      const conn = await connectionFor(c, c.req.param('id'))
      const group = await getGroupRow(c.var.db, conn, c.req.param('groupId')).catch(() => null)
      if (!group) throw new HTTPException(404, { message: 'No such group' })
      await setGroupGrantsAdmin(c.var.db, group, c.req.valid('json').grantsAdmin)
      const events = await syncRoles(c.var.db, conn, await memberIdsOf(c.var.db, group.id))
      c.executionCtx.waitUntil(
        Promise.all(
          events.map((e) =>
            recordAudit(c.var.db, {
              type: e.type,
              outcome: 'success',
              userId: e.userId,
              now: Date.now()
            }).catch((error: unknown) => Sentry.captureException(error))
          )
        )
      )
      audit(c, c.req.valid('json').grantsAdmin ? 'scim_group_role_on' : 'scim_group_role_off')
      return c.body(null, 204)
    }
  )

  // People who deleted their accounts are not recreated by the directory until an owner allows it.
  admin.delete('/:id/tombstones', async (c) => {
    const conn = await connectionFor(c, c.req.param('id'))
    await clearTombstones(c.var.db, conn.organizationId)
    return c.body(null, 204)
  })

  // Removing a connection deletes its directory records (not the sign-in accounts or the team members).
  admin.delete('/:id', async (c) => {
    const conn = await connectionFor(c, c.req.param('id'))
    await c.var.db.delete(schema.scimConnection).where(eq(schema.scimConnection.id, conn.id))
    audit(c, 'scim_connection_removed')
    return c.body(null, 204)
  })

  return admin
}
