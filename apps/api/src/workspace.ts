import { and, eq } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { schema, type Db } from './db'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'

/**
 * Which workspace a signed-in person is working in: one of their teams, or "Personal" (no team).
 *
 * Use `workspaceOf` in any route that stores or reads data that belongs to a workspace. The rules it enforces:
 *  1. The team comes from the session's active team, read from the database (not the cookie), and counts only if the
 *     person is still a member: nobody clears the active team of someone who was removed from it.
 *  2. Limit every query to `teamId` (or, when it is null, to the person's own rows).
 *  3. Give the table a foreign key to `organization` with `onDelete: 'cascade'`, and put it in the data export.
 */
export interface Workspace {
  /** The team's id, or null for Personal. */
  teamId: string | null
  teamName: string | null
  /** The person's role in the team (empty for Personal). */
  role: string
}

const PERSONAL: Workspace = { teamId: null, teamName: null, role: '' }

export async function workspaceOf(db: Db, userId: string, sessionId: string): Promise<Workspace> {
  const [row] = await db
    .select({ teamId: schema.session.activeOrganizationId })
    .from(schema.session)
    .where(and(eq(schema.session.id, sessionId), eq(schema.session.userId, userId)))
  if (!row?.teamId) return PERSONAL
  const [seat] = await db
    .select({ role: schema.member.role, name: schema.organization.name })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.organizationId, row.teamId), eq(schema.member.userId, userId)))
  return seat ? { teamId: row.teamId, teamName: seat.name, role: seat.role } : PERSONAL
}

/** A viewer reads the workspace but changes nothing, unless they also hold a stronger role. */
export const canWrite = (w: Workspace): boolean =>
  !w.teamId ||
  !w.role
    .split(',')
    .map((r) => r.trim())
    .includes('viewer') ||
  managesTeam(w)

/** Does the role include owner or admin? (A person can hold several roles, written "owner,admin".) */
export const managesTeam = (w: Workspace): boolean =>
  w.role.includes('owner') || w.role.includes('admin')

type WorkspaceEnv = {
  Bindings: Bindings
  Variables: { db: Db; userId: string; sessionId: string }
}

/**
 * `GET /api/workspace` says which workspace this session is in. Switching is done with Better Auth's
 * `organization.setActive` (the web app's switcher), which also refreshes the session cookie.
 */
export function createWorkspaceApi(requireSession: MiddlewareHandler): Hono<WorkspaceEnv> {
  const api = new Hono<WorkspaceEnv>()
  api.use(sameOriginOnly)
  api.use(requireSession)
  api.use(async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  })
  api.get('/', async (c) => c.json(await workspaceOf(c.var.db, c.var.userId, c.var.sessionId)))
  return api
}
