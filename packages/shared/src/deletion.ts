import { z } from 'zod'

/** How long an account stays (and can still be saved) between asking to delete it and it really going. */
export const DELETION_COOLING_OFF_DAYS = 14

/** What asking to delete answers: when the account will be removed unless the person cancels. */
export const deletionScheduledSchema = z.object({ scheduledFor: z.string() })

/** The cancel link in the email carries this token to the cancel page, which sends it back here. */
export const cancelDeletionInputSchema = z.object({ token: z.string().min(20).max(200) })

export type DeletionScheduled = z.infer<typeof deletionScheduledSchema>

/** When an account asked for deletion at `now` will be removed (ms since 1970). */
export const deletionDate = (now: number): number => now + DELETION_COOLING_OFF_DAYS * 86_400_000
