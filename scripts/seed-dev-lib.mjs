// SQL for the local development database: a few fake people with preferences. Pure, so it is unit tested.
// Everything uses fixed ids and INSERT OR REPLACE, so running it twice gives the same data.

export const SEED_DOMAIN = 'example.test'
const ACCENTS = ['neutral', 'blue', 'violet', 'green', 'orange', 'rose']
const THEMES = ['system', 'light', 'dark']

/** Single quotes doubled, the only escaping SQLite string literals need. */
export function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

/** `count` fake people (1 to 50), the same ones every time. */
export function fakeUsers(count, now = Date.UTC(2026, 0, 1)) {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error('Choose between 1 and 50 users.')
  }
  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    return {
      id: `seed-user-${n}`,
      name: `Test Person ${n}`,
      email: `person${n}@${SEED_DOMAIN}`,
      createdAt: now + n * 86_400_000,
      preferences: { theme: THEMES[i % THEMES.length], accent: ACCENTS[i % ACCENTS.length] }
    }
  })
}

/** The SQL file to run against the local database. */
export function buildSeedSql(users) {
  const lines = ['-- Fake data for local development. Safe to run again.']
  for (const u of users) {
    lines.push(
      `INSERT OR REPLACE INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (${quote(u.id)}, ${quote(u.name)}, ${quote(u.email)}, 1, ${u.createdAt}, ${u.createdAt});`,
      `INSERT OR REPLACE INTO preference (user_id, data, updated_at) VALUES (${quote(u.id)}, ${quote(JSON.stringify(u.preferences))}, ${u.createdAt});`
    )
  }
  return lines.join('\n') + '\n'
}

/** Read `--users N` from the arguments (default 5) and refuse anything that could reach the real database. */
export function parseArgs(args) {
  let users = 5
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--users') {
      users = Number(args[++i])
    } else if (arg.startsWith('--users=')) {
      users = Number(arg.slice('--users='.length))
    } else {
      throw new Error(`Unknown option "${arg}". The seed only ever writes to the local database.`)
    }
  }
  return { users }
}
