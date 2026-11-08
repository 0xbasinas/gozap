import { z } from 'zod'

/** How long the link in the confirmation email works. */
export const EMAIL_CHANGE_MINUTES = 60

/** The new address to move the account to. It is lower-cased so it matches how addresses are stored. */
export const changeEmailInputSchema = z.object({
  newEmail: z.string().trim().toLowerCase().pipe(z.email().max(254))
})

/** The link in the confirmation email carries this token to the confirm page, which sends it back here. */
export const confirmEmailChangeInputSchema = z.object({ token: z.string().min(20).max(200) })

/** What confirming answers: the address the account now uses. */
export const emailChangedSchema = z.object({ email: z.string() })

export type EmailChanged = z.infer<typeof emailChangedSchema>
