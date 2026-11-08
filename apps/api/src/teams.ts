import { and, eq, inArray, sql } from 'drizzle-orm'
import type { Db } from './db'
import { schema } from './db'
import type { EmailMessage } from './email'

/** Limits per person and per team, so one account cannot fill the tables (free tier). */
export const MAX_TEAMS_PER_PERSON = 5
export const MAX_MEMBERS_PER_TEAM = 50
export const INVITATION_DAYS = 7

const escape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Sent to the invited address. The link opens the site, where the person signs in with that address and accepts. */
export function invitationEmail(
  appName: string,
  input: { teamName: string; inviter: string; url: string }
): Omit<EmailMessage, 'to'> {
  const { teamName, inviter, url } = input
  return {
    subject: `${inviter} invited you to ${teamName} on ${appName}`,
    text: [
      `${inviter} invited you to join "${teamName}" on ${appName}.`,
      '',
      `Open this link and sign in with this email address to accept. It expires in ${INVITATION_DAYS} days:`,
      '',
      url,
      '',
      "Don't know them? Ignore this email and nothing happens."
    ].join('\n'),
    html: `<!doctype html><html lang="en"><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#18181b">
<h1 style="font-size:20px">You are invited to ${escape(teamName)}</h1>
<p>${escape(inviter)} invited you to join <strong>${escape(teamName)}</strong> on ${escape(appName)}.</p>
<p><a href="${escape(url)}">Accept the invitation</a><br><span style="font-size:14px;color:#52525b">Sign in with this email address. The link expires in ${INVITATION_DAYS} days.</span></p>
<p style="font-size:14px;color:#52525b">Don't know them? Ignore this email and nothing happens.</p>
</body></html>`
  }
}

export interface TeamExport {
  name: string
  role: string
  joinedAt: string
}

/** The teams a person belongs to, for the data export. */
export async function teamsOf(db: Db, userId: string): Promise<TeamExport[]> {
  const rows = await db
    .select({
      name: schema.organization.name,
      role: schema.member.role,
      joinedAt: schema.member.createdAt
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(eq(schema.member.userId, userId))
  return rows.map((r) => ({ name: r.name, role: r.role, joinedAt: r.joinedAt.toISOString() }))
}

/**
 * Statements that remove the teams only this person belongs to (deleting the account would otherwise leave a team
 * nobody can reach). Run in the same batch as the account deletion; the foreign keys remove members and invitations.
 */
export function soloTeamsDeletion(db: Db, userId: string) {
  const mine = db
    .select({ id: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
  const shared = db
    .select({ id: schema.member.organizationId })
    .from(schema.member)
    .where(
      and(inArray(schema.member.organizationId, mine), sql`${schema.member.userId} <> ${userId}`)
    )
  return db
    .delete(schema.organization)
    .where(
      and(inArray(schema.organization.id, mine), sql`${schema.organization.id} not in ${shared}`)
    )
}
