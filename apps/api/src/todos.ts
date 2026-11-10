import { zValidator } from '@hono/zod-validator'
import { and, asc, count, eq, isNull } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { schema, type Db } from './db'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'
import { canWrite, managesTeam, workspaceOf, type Workspace } from './workspace'

/**
 * A to-do list that belongs to a workspace: the small, copyable example of workspace data. With no team active it is
 * the person's own list ("Personal"); with a team active it is the team's, and every member can add, tick and remove.
 * Only the person who added an item, or a team owner or admin, can remove it.
 */

export const MAX_TODOS_PER_WORKSPACE = 200
const addSchema = z.object({ title: z.string().trim().min(1).max(200) })
const doneSchema = z.object({ done: z.boolean() })

type TodosEnv = { Bindings: Bindings; Variables: { db: Db; userId: string; sessionId: string } }

const inWorkspace = (w: Workspace, userId: string) =>
  w.teamId
    ? eq(schema.todo.organizationId, w.teamId)
    : and(isNull(schema.todo.organizationId), eq(schema.todo.userId, userId))

export function createTodosApi(requireSession: MiddlewareHandler): Hono<TodosEnv> {
  const todos = new Hono<TodosEnv>()
  todos.use(sameOriginOnly)
  todos.use(requireSession)
  todos.use(async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  })

  todos.get('/', async (c) => {
    const w = await workspaceOf(c.var.db, c.var.userId, c.var.sessionId)
    const rows = await c.var.db
      .select({
        id: schema.todo.id,
        title: schema.todo.title,
        done: schema.todo.done,
        userId: schema.todo.userId,
        author: schema.user.name
      })
      .from(schema.todo)
      .innerJoin(schema.user, eq(schema.user.id, schema.todo.userId))
      .where(inWorkspace(w, c.var.userId))
      .orderBy(asc(schema.todo.createdAt))
      .limit(MAX_TODOS_PER_WORKSPACE)
    return c.json({
      workspace: { teamId: w.teamId, teamName: w.teamName, canWrite: canWrite(w) },
      todos: rows.map((r) => ({
        id: r.id,
        title: r.title,
        done: r.done,
        author: r.author,
        mine: r.userId === c.var.userId,
        canRemove: r.userId === c.var.userId || managesTeam(w)
      }))
    })
  })

  todos.post('/', zValidator('json', addSchema), async (c) => {
    const w = await workspaceOf(c.var.db, c.var.userId, c.var.sessionId)
    if (!canWrite(w))
      throw new HTTPException(403, { message: 'Viewers can read this list but not change it' })
    const [have] = await c.var.db
      .select({ n: count() })
      .from(schema.todo)
      .where(inWorkspace(w, c.var.userId))
    if ((have?.n ?? 0) >= MAX_TODOS_PER_WORKSPACE)
      throw new HTTPException(409, {
        message: `A list holds up to ${MAX_TODOS_PER_WORKSPACE} items. Remove one first.`
      })
    const id = crypto.randomUUID()
    await c.var.db.insert(schema.todo).values({
      id,
      userId: c.var.userId,
      organizationId: w.teamId,
      title: c.req.valid('json').title,
      createdAt: Date.now()
    })
    return c.json({ id }, 201)
  })

  // Tick or untick. Any member of the workspace may do this.
  todos.patch('/:id', zValidator('json', doneSchema), async (c) => {
    const w = await workspaceOf(c.var.db, c.var.userId, c.var.sessionId)
    if (!canWrite(w))
      throw new HTTPException(403, { message: 'Viewers can read this list but not change it' })
    const changed = await c.var.db
      .update(schema.todo)
      .set({ done: c.req.valid('json').done })
      .where(and(eq(schema.todo.id, c.req.param('id')), inWorkspace(w, c.var.userId)))
      .returning({ id: schema.todo.id })
    // An item in another workspace looks exactly like one that does not exist.
    if (changed.length === 0) throw new HTTPException(404, { message: 'Not found' })
    return c.body(null, 204)
  })

  todos.delete('/:id', async (c) => {
    const w = await workspaceOf(c.var.db, c.var.userId, c.var.sessionId)
    if (!canWrite(w))
      throw new HTTPException(403, { message: 'Viewers can read this list but not change it' })
    const [row] = await c.var.db
      .select({ userId: schema.todo.userId })
      .from(schema.todo)
      .where(and(eq(schema.todo.id, c.req.param('id')), inWorkspace(w, c.var.userId)))
    if (!row) throw new HTTPException(404, { message: 'Not found' })
    if (row.userId !== c.var.userId && !managesTeam(w))
      throw new HTTPException(403, {
        message: 'Only whoever added this or a team admin can remove it'
      })
    await c.var.db.delete(schema.todo).where(eq(schema.todo.id, c.req.param('id')))
    return c.body(null, 204)
  })

  return todos
}

/** What a person added, for the data export: every workspace, with the team name (null for Personal). */
export async function todosOf(
  db: Db,
  userId: string
): Promise<{ team: string | null; title: string; done: boolean; createdAt: string }[]> {
  const rows = await db
    .select({
      team: schema.organization.name,
      title: schema.todo.title,
      done: schema.todo.done,
      createdAt: schema.todo.createdAt
    })
    .from(schema.todo)
    .leftJoin(schema.organization, eq(schema.organization.id, schema.todo.organizationId))
    .where(eq(schema.todo.userId, userId))
    .orderBy(asc(schema.todo.createdAt))
  return rows.map((r) => ({
    team: r.team,
    title: r.title,
    done: r.done,
    createdAt: new Date(r.createdAt).toISOString()
  }))
}
