import { z } from 'zod'

/** The version of the privacy policy and terms people agree to. Change it when they change; old records keep theirs. */
export const POLICY_VERSION = '2026-01'

/** What a person can agree to. Add a purpose here to start asking for it. */
export const CONSENT_PURPOSES = ['product-emails', 'crash-reports'] as const
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number]

export const CONSENT_LABELS: Record<ConsentPurpose, { title: string; description: string }> = {
  'product-emails': {
    title: 'Product emails',
    description: 'News about new features. Sign-in and security emails are always sent.'
  },
  'crash-reports': {
    title: 'Crash reports',
    description: 'Send anonymous error reports from the app to help us fix bugs.'
  }
}

/** One entry in the ledger: what was agreed to or withdrawn, under which policy, and when. Entries are never edited. */
export const consentEventSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean(),
  policyVersion: z.string(),
  at: z.string()
})
export type ConsentEvent = z.infer<typeof consentEventSchema>

export const consentsSchema = z.object({
  /** The latest answer for each purpose that has one. A purpose with no entry was never agreed to. */
  current: z.record(z.string(), z.boolean()),
  /** Every entry, newest first. */
  history: z.array(consentEventSchema)
})
export type Consents = z.infer<typeof consentsSchema>

export const setConsentInputSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  granted: z.boolean()
})

/** The latest answer per purpose from entries ordered newest first. */
export function currentConsents(history: ConsentEvent[]): Record<string, boolean> {
  const current: Record<string, boolean> = {}
  for (const e of history) if (!(e.purpose in current)) current[e.purpose] = e.granted
  return current
}
