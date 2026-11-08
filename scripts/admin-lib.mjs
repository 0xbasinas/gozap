// Pure helpers for `pnpm admin:grant`: build the SQL that gives or takes away a staff role. Tested with `node --test`.

const ROLES = ['admin', 'support', 'user']
const EMAIL = /^[^\s@'"\\;]+@[^\s@'"\\;]+\.[^\s@'"\\;]+$/

/** SQL for `grant <email> [admin|support]` and `revoke <email>`. The email must belong to an existing account. */
export function roleSql(command, email, role = 'admin') {
  const address = String(email ?? '')
    .trim()
    .toLowerCase()
  if (!EMAIL.test(address)) throw new Error('Give the email address of an existing account.')
  if (command === 'revoke') return `UPDATE user SET role = 'user' WHERE email = '${address}';`
  if (command !== 'grant') throw new Error('Use: grant <email> [admin|support] or revoke <email>.')
  if (!ROLES.includes(role) || role === 'user')
    throw new Error(`The role is admin or support, not "${role}".`)
  return `UPDATE user SET role = '${role}' WHERE email = '${address}';`
}
