import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'

/** Roles for the admin plugin. A person with neither is an ordinary user and can do nothing here. */
export const ac = createAccessControl(defaultStatements)

export const roles = {
  /** Everything except deleting accounts (our own cooling-off flow does that) and impersonating other admins. */
  admin: ac.newRole({
    user: ['create', 'list', 'set-role', 'ban', 'impersonate', 'set-password', 'get', 'update'],
    session: ['list', 'revoke', 'delete']
  }),
  /** Read only: can look people up and see their sessions, nothing else. */
  support: ac.newRole({ user: ['list', 'get'], session: ['list'] }),
  user: ac.newRole({})
}

export const STAFF_ROLES = ['admin', 'support'] as const
