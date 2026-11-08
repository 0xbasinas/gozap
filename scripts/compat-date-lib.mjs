// Pure helpers for scripts/compat-date.mjs: keeps `compatibility_date` in apps/api/wrangler.jsonc from going stale.

/** workerd versions look like 1.20261104.1; the middle part is the date of its newest supported compatibility date. */
export function workerdDate(version) {
  const match = /^\d+\.(\d{4})(\d{2})(\d{2})\.\d+/.exec(version)
  if (!match) throw new Error(`Unexpected workerd version: ${version}`)
  return `${match[1]}-${match[2]}-${match[3]}`
}

export function readCompatDate(config) {
  const match = /"compatibility_date":\s*"(\d{4}-\d{2}-\d{2})"/.exec(config)
  if (!match) throw new Error('wrangler.jsonc has no compatibility_date')
  return match[1]
}

export function setCompatDate(config, date) {
  readCompatDate(config)
  return config.replace(/("compatibility_date":\s*)"\d{4}-\d{2}-\d{2}"/, `$1"${date}"`)
}

const DAY = 86_400_000
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY)

/**
 * Decide what to do. A date newer than the installed runtime is a mistake (wrangler would fall back with a warning);
 * an old date only matters once it is far behind, because behaviour changes are opt-in by date.
 */
export function assess({ configDate, runtimeDate, maxAgeDays = 180 }) {
  if (configDate > runtimeDate) {
    return {
      status: 'ahead',
      target: runtimeDate,
      message: `compatibility_date ${configDate} is newer than the installed runtime supports (${runtimeDate}).`
    }
  }
  const age = daysBetween(configDate, runtimeDate)
  if (age > maxAgeDays) {
    return {
      status: 'stale',
      target: runtimeDate,
      message: `compatibility_date ${configDate} is ${age} days behind the runtime (${runtimeDate}).`
    }
  }
  return {
    status: 'ok',
    target: configDate,
    message: `compatibility_date ${configDate} is current enough (runtime ${runtimeDate}).`
  }
}
