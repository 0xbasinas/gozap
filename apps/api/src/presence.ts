import { zValidator } from '@hono/zod-validator'
import { and, eq, gt, inArray } from 'drizzle-orm'
import { Hono, type MiddlewareHandler } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import { schema, type Db } from './db'
import type { Bindings } from './env'
import { sameOriginOnly } from './origin'

/**
 * Who is online. Opt-in: nobody is shown, and nothing is stored about when they are active, until they switch
 * "Show when I am online to my teams" on. The page then sends a ping every couple of minutes while it is open and
 * visible; a person counts as online for a few minutes after their last ping. Only people who share a team can see it.
 * One small write per ping, and only for people who opted in, which keeps this inside the free database limits.
 */

export const ONLINE_WINDOW_MS = 5 * 60_000

type PresenceEnv = { Bindings: Bindings; Variables: { db: Db; userId: string } }

const settingSchema = z.object({ visible: z.boolean() })

export function createPresenceApi(requireSession: MiddlewareHandler): Hono<PresenceEnv> {
  const presence = new Hono<PresenceEnv>()
  presence.use(sameOriginOnly)
  presence.use(requireSession)
  presence.use(async (c, next) => {
    c.header('cache-control', 'no-store')
    await next()
  })

  presence.get('/me', async (c) => {
    const [row] = await c.var.db
      .select({ visible: schema.presence.visible })
      .from(schema.presence)
      .where(eq(schema.presence.userId, c.var.userId))
    return c.json({ visible: row?.visible ?? false })
  })

  presence.put('/me', zValidator('json', settingSchema), async (c) => {
    const { visible } = c.req.valid('json')
    await c.var.db
      .insert(schema.presence)
      .values({ userId: c.var.userId, visible, lastSeen: visible ? Date.now() : 0 })
      .onConflictDoUpdate({
        target: schema.presence.userId,
        // Switching it off forgets when they were last seen.
        set: visible ? { visible, lastSeen: Date.now() } : { visible, lastSeen: 0 }
      })
    return c.json({ visible })
  })

  // "I am here." Only does something for someone who opted in.
  presence.post('/ping', async (c) => {
    await c.var.db
      .update(schema.presence)
      .set({ lastSeen: Date.now() })
      .where(and(eq(schema.presence.userId, c.var.userId), eq(schema.presence.visible, true)))
    return c.body(null, 204)
  })

  // The members of one team who opted in and were seen lately. The caller must be in that team.
  presence.get('/team/:teamId', async (c) => {
    const teamId = c.req.param('teamId')
    const [seat] = await c.var.db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, teamId), eq(schema.member.userId, c.var.userId)))
    // A team you are not in looks exactly like a team that does not exist.
    if (!seat) throw new HTTPException(404, { message: 'Not found' })
    const members = c.var.db
      .select({ id: schema.member.userId })
      .from(schema.member)
      .where(eq(schema.member.organizationId, teamId))
    const online = await c.var.db
      .select({ userId: schema.presence.userId, name: schema.user.name, email: schema.user.email })
      .from(schema.presence)
      .innerJoin(schema.user, eq(schema.user.id, schema.presence.userId))
      .where(
        and(
          eq(schema.presence.visible, true),
          gt(schema.presence.lastSeen, Date.now() - ONLINE_WINDOW_MS),
          inArray(schema.presence.userId, members)
        )
      )
    return c.json({ online: online.map((p) => ({ userId: p.userId, name: p.name || p.email })) })
  })

  return presence
}

/** For the data export: the person's own setting and when they were last seen. */
export async function presenceOf(
  db: Db,
  userId: string
): Promise<{ visible: boolean; lastSeenAt: string | null } | null> {
  const [row] = await db.select().from(schema.presence).where(eq(schema.presence.userId, userId))
  if (!row) return null
  return {
    visible: row.visible,
    lastSeenAt: row.lastSeen > 0 ? new Date(row.lastSeen).toISOString() : null
  }
}
