import { FLAG_CHANNELS, isFlagOn, type FlagChannel, type FlagRule } from '@repo/shared'
import type { Db } from './db'
import { schema } from './db'

const toRule = (row: typeof schema.featureFlag.$inferSelect): FlagRule => ({
  killed: row.killed,
  channels: row.channels
    .split(',')
    .filter((c): c is FlagChannel => (FLAG_CHANNELS as readonly string[]).includes(c)),
  percent: Math.min(100, Math.max(0, row.percent))
})

let cache: { at: number; rules: Map<string, FlagRule> } | undefined

/**
 * Every flag's rule. The table is tiny but every app install asks for it every few minutes, so one Worker instance
 * keeps the answer for `cacheMs` (so a kill switch takes at most that long, plus the clients' own refresh, to arrive).
 */
export async function loadRules(
  db: Db,
  now: number,
  cacheMs: number
): Promise<Map<string, FlagRule>> {
  if (cache && now - cache.at < cacheMs) return cache.rules
  const rows = await db.select().from(schema.featureFlag)
  const rules = new Map(rows.map((row) => [row.key, toRule(row)]))
  cache = { at: now, rules }
  return rules
}

/** What one install gets: each flag's key and whether it is on. Flags that do not exist are simply absent (off). */
export function evaluateFlags(
  rules: Map<string, FlagRule>,
  channel: FlagChannel,
  installId?: string
): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const [key, rule] of rules) flags[key] = isFlagOn(key, rule, channel, installId)
  return flags
}
