// Pure helpers for `pnpm flags`: build the SQL that changes a feature flag. Tested with `node --test`.

const KEY = /^[a-z][a-z0-9-]{0,39}$/
const CHANNELS = ['stable', 'beta']

export function checkKey(key) {
  if (!KEY.test(key ?? ''))
    throw new Error('A flag key is lower-case letters, digits and dashes, starting with a letter.')
  return key
}

const quote = (text) => `'${String(text).replaceAll("'", "''")}'`

/** SQL for one command. `args` are the options after the key: percent, channels, description. */
export function flagSql(command, key, args = {}, now = Date.now()) {
  if (command === 'list')
    return 'SELECT key, killed, channels, percent, description FROM feature_flag ORDER BY key;'
  checkKey(key)
  if (command === 'kill' || command === 'revive') {
    return `UPDATE feature_flag SET killed = ${command === 'kill' ? 1 : 0}, updated_at = ${now} WHERE key = ${quote(key)};`
  }
  if (command === 'delete') return `DELETE FROM feature_flag WHERE key = ${quote(key)};`
  if (command === 'set') {
    const percent = args.percent === undefined ? 100 : Number(args.percent)
    if (!Number.isInteger(percent) || percent < 0 || percent > 100)
      throw new Error('--percent must be 0 to 100.')
    const channels = args.channels ? String(args.channels).split(',').filter(Boolean) : []
    for (const c of channels)
      if (!CHANNELS.includes(c))
        throw new Error(`Unknown channel "${c}" (use ${CHANNELS.join(', ')}).`)
    const description = String(args.description ?? '').slice(0, 200)
    return (
      `INSERT INTO feature_flag (key, description, killed, channels, percent, updated_at) VALUES ` +
      `(${quote(key)}, ${quote(description)}, 0, ${quote(channels.join(','))}, ${percent}, ${now}) ` +
      `ON CONFLICT(key) DO UPDATE SET description = excluded.description, channels = excluded.channels, ` +
      `percent = excluded.percent, updated_at = excluded.updated_at;`
    )
  }
  throw new Error('Commands: list, set <key>, kill <key>, revive <key>, delete <key>.')
}
