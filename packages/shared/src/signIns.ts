import { z } from 'zod'

/** How many recent sign-ins the account page lists. */
export const SIGN_IN_ACTIVITY_LIMIT = 20

/** One sign-in as the person sees it. */
export const signInSchema = z.object({
  at: z.string(),
  /** "Chrome on Windows" ... worked out from the user agent. */
  label: z.string(),
  ipAddress: z.string().nullable(),
  /** The first time this browser and system combination signed in to the account. */
  newDevice: z.boolean()
})

export const signInsSchema = z.array(signInSchema)

export type SignIn = z.infer<typeof signInSchema>
