import { createAccessControl } from 'better-auth/plugins/access'
import { adminAc, defaultStatements, ownerAc } from 'better-auth/plugins/organization/access'
import { z } from 'zod'

/**
 * The roles inside a team. owner and admin are Better Auth's own. `member` is allowed to invite (statically); whether a
 * plain member really may is the team's own setting, `membersCanInvite`, checked in the auth hook (see auth.ts). A
 * `viewer` can do nothing to the team itself, and the product's own routes treat them as read-only (see workspace.ts).
 */
export const teamAc = createAccessControl(defaultStatements)
export const teamRoles = {
  owner: ownerAc,
  admin: adminAc,
  member: teamAc.newRole({ invitation: ['create'] }),
  viewer: teamAc.newRole({})
}

/** The roles a person may be given by an owner or admin, or invited as. (Owner has its own "make owner" step.) */
export const ASSIGNABLE_ROLES = ['admin', 'member', 'viewer'] as const

/** What a team may keep in its `metadata`: only these settings, so the field cannot be used to store anything else. */
export const teamSettingsSchema = z.object({ membersCanInvite: z.boolean().optional() }).strict()

/** Whether a role string (a person may hold several, written "member,viewer") is only the plain kinds. */
export const isPlainMember = (role: string): boolean => {
  const parts = role.split(',').map((r) => r.trim())
  return !parts.includes('owner') && !parts.includes('admin')
}

/** Parse a team's stored settings (JSON text or an object); anything unexpected means "no settings". */
export function readTeamSettings(metadata: unknown): { membersCanInvite: boolean } {
  let value: unknown = metadata
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      return { membersCanInvite: false }
    }
  }
  const parsed = teamSettingsSchema.safeParse(value)
  return { membersCanInvite: parsed.success && parsed.data.membersCanInvite === true }
}
