import { describeDevice } from '@repo/shared'
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { recentAudit, recordAudit } from './audit'
import type { Db } from './db'
import { schema } from './db'
import { teamsOf } from './teams'
import { MCP_WRITE_SCOPE } from './auth'

/**
 * What an AI app may do for a person who approved it: read their own account. Nothing here changes data, and every
 * query is limited to the person the token was issued to (never to an id the app supplies).
 */
function buildServer(db: Db, userId: string, appName: string, scopes: string[]): McpServer {
  const server = new McpServer({ name: appName, version: '1.0.0' })
  const reply = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: { result: value }
  })
  const read = { readOnlyHint: true, destructiveHint: false, openWorldHint: false }

  server.registerTool(
    'whoami',
    {
      title: 'Who am I',
      description: 'The name, email address and creation date of the signed-in account.',
      inputSchema: z.object({}),
      annotations: read
    },
    async () => {
      const [me] = await db
        .select({
          name: schema.user.name,
          email: schema.user.email,
          createdAt: schema.user.createdAt
        })
        .from(schema.user)
        .where(eq(schema.user.id, userId))
      return reply(me ? { ...me, createdAt: me.createdAt.toISOString() } : null)
    }
  )

  server.registerTool(
    'list_teams',
    {
      title: 'List teams',
      description: 'The teams the account belongs to, with its role in each.',
      inputSchema: z.object({}),
      annotations: read
    },
    async () => reply(await teamsOf(db, userId))
  )

  server.registerTool(
    'list_devices',
    {
      title: 'List devices',
      description:
        'Where the account is signed in: one entry per device with when it was last used.',
      inputSchema: z.object({}),
      annotations: read
    },
    async () => {
      const rows = await db
        .select({
          id: schema.session.id,
          userAgent: schema.session.userAgent,
          createdAt: schema.session.createdAt,
          updatedAt: schema.session.updatedAt
        })
        .from(schema.session)
        .where(eq(schema.session.userId, userId))
      return reply(
        rows.map((r) => ({
          id: r.id,
          device: describeDevice(r.userAgent),
          signedInAt: r.createdAt.toISOString(),
          lastUsedAt: r.updatedAt.toISOString()
        }))
      )
    }
  )

  server.registerTool(
    'recent_security_activity',
    {
      title: 'Recent security activity',
      description: 'The latest sign-ins, failed attempts and account changes (newest first).',
      inputSchema: z.object({}),
      annotations: read
    },
    async () => reply(await recentAudit(db, userId))
  )

  // The one thing an app may change, and only when the person gave it the write permission: sign a device out.
  if (scopes.includes(MCP_WRITE_SCOPE)) {
    server.registerTool(
      'sign_out_device',
      {
        title: 'Sign out a device',
        description:
          'Signs one device out of the account. Use an id from list_devices. The person can sign in again there.',
        inputSchema: z.object({ id: z.string().min(1).max(200) }),
        annotations: {
          readOnlyHint: false,
          destructiveHint: true,
          idempotentHint: true,
          openWorldHint: false
        }
      },
      async ({ id }) => {
        // Limited to the token's own person: an id that belongs to anyone else matches nothing.
        const removed = await db
          .delete(schema.session)
          .where(and(eq(schema.session.id, id), eq(schema.session.userId, userId)))
          .returning({ id: schema.session.id })
        if (removed.length > 0)
          await recordAudit(db, {
            type: 'session_revoked',
            outcome: 'success',
            userId,
            now: Date.now()
          }).catch((error: unknown) => console.error('Could not record the sign-out', error))
        return reply({ signedOut: removed.length > 0 })
      }
    )
  }

  return server
}

/**
 * True when the request calls a tool that needs the write permission and the token lacks it. The sign-out tool is not
 * listed for a read-only app, so an app that knows about it anyway (or was updated to use it) gets a step-up answer
 * instead of "no such tool": it can then ask the person to approve again with the extra permission.
 */
async function needsWriteStepUp(request: Request, scopes: string[]): Promise<boolean> {
  if (scopes.includes(MCP_WRITE_SCOPE) || request.method !== 'POST') return false
  const body = (await request
    .clone()
    .json()
    .catch(() => null)) as { method?: unknown; params?: { name?: unknown } } | null
  return body?.method === 'tools/call' && body.params?.name === 'sign_out_device'
}

/** Answers one MCP request for the person the (already verified) token belongs to. Stateless; 2025-era traffic is refused. */
export async function handleMcp(
  request: Request,
  db: Db,
  userId: string,
  appName: string,
  scopes: string[] = [],
  metadataUrl?: string
): Promise<Response> {
  // RFC 6750 section 3.1: 403 with an insufficient_scope challenge naming the missing permission.
  if (await needsWriteStepUp(request, scopes))
    return Response.json(
      {
        error: 'insufficient_scope',
        error_description: `The ${MCP_WRITE_SCOPE} permission is needed.`
      },
      {
        status: 403,
        headers: {
          'WWW-Authenticate': [
            'Bearer error="insufficient_scope"',
            `scope="${MCP_WRITE_SCOPE}"`,
            ...(metadataUrl ? [`resource_metadata="${metadataUrl}"`] : [])
          ].join(', ')
        }
      }
    )
  const handler = createMcpHandler(() => buildServer(db, userId, appName, scopes), {
    legacy: 'reject'
  })
  return handler.fetch(request)
}
