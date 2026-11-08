import { z } from 'zod'

/** Update channels a flag can be limited to. */
export const FLAG_CHANNELS = ['stable', 'beta'] as const
export type FlagChannel = (typeof FLAG_CHANNELS)[number]

/** A flag as stored: who gets the feature, and the kill switch that turns it off for everybody. */
export interface FlagRule {
  /** The kill switch. When true the feature is off for everyone, whatever else is set. */
  killed: boolean
  /** Channels that get the feature, or empty for all of them. */
  channels: FlagChannel[]
  /** 0 to 100: the share of installs that get the feature. */
  percent: number
}

/** What a client asks for: the channel it is on and its random install id. */
export const flagsQuerySchema = z.object({
  channel: z.enum(FLAG_CHANNELS).default('stable'),
  id: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional()
})

/** What the API answers: each flag's key and whether it is on for that client. */
export const flagsSchema = z.object({ flags: z.record(z.string(), z.boolean()) })
export type Flags = z.infer<typeof flagsSchema>

/** Flag keys are short, lower-case and safe to use in a URL, a column and a variable name. */
export const flagKeySchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/)

/** FNV-1a: a small, stable hash, so the same install always lands in the same part of the 0-99 range. */
function bucket(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash % 100
}

/**
 * Is a flag on for this install? Killed beats everything. Then the channel has to match (an empty list means every
 * channel). Then the install must fall inside the percentage: the bucket comes from the key and the install id, so
 * the same install keeps its answer and raising the percentage only ever adds installs. Without an id, only 0% and
 * 100% are decidable, so anything in between is off.
 */
export function isFlagOn(
  key: string,
  rule: FlagRule,
  channel: FlagChannel,
  installId?: string
): boolean {
  if (rule.killed) return false
  if (rule.channels.length > 0 && !rule.channels.includes(channel)) return false
  if (rule.percent >= 100) return true
  if (rule.percent <= 0) return false
  if (!installId) return false
  return bucket(`${key}:${installId}`) < rule.percent
}
