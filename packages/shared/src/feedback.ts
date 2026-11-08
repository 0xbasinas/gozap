import { z } from 'zod'

export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const
export const FEEDBACK_MESSAGE_MAX = 4000
export const FEEDBACK_DIAGNOSTICS_MAX = 24000
/** How many pieces of feedback one person can send per hour (keeps the free tier safe from a loop or abuse). */
export const FEEDBACK_PER_HOUR = 5

export const feedbackKindSchema = z.enum(FEEDBACK_KINDS)

/** What the web app and the desktop app send. `diagnostics` is the optional report from Settings. */
export const feedbackInputSchema = z.object({
  kind: feedbackKindSchema,
  message: z.string().trim().min(3).max(FEEDBACK_MESSAGE_MAX),
  diagnostics: z.string().max(FEEDBACK_DIAGNOSTICS_MAX).optional(),
  appVersion: z.string().max(64).optional(),
  platform: z.string().max(32).optional(),
  source: z.enum(['web', 'desktop'])
})

export const feedbackReceiptSchema = z.object({ id: z.string() })

/** One piece of feedback as it appears in the "download my data" file. */
export const feedbackExportSchema = z.object({
  kind: feedbackKindSchema,
  message: z.string(),
  source: z.string(),
  hasDiagnostics: z.boolean(),
  createdAt: z.string()
})

export type FeedbackKind = z.infer<typeof feedbackKindSchema>
export type FeedbackInput = z.infer<typeof feedbackInputSchema>
