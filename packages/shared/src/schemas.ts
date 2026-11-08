import { z } from 'zod'
import { preferencesRecordSchema } from './preferences'

/** An email address, normalised the same way everywhere (trimmed, lower case). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))

/** The signed-in person, as shown on the account page. */
export const accountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string()
})

/** Everything we hold about a person (the "download my data" file). No tokens or secrets are included. */
export const accountExportSchema = z.object({
  exportedAt: z.string(),
  account: accountSchema,
  preferences: preferencesRecordSchema,
  passkeys: z.array(
    z.object({
      name: z.string().nullable(),
      deviceType: z.string(),
      createdAt: z.string().nullable()
    })
  ),
  sessions: z.array(
    z.object({
      createdAt: z.string(),
      expiresAt: z.string(),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable()
    })
  )
})

/** Deleting an account needs the email typed again, so it cannot happen by a stray click or request. */
export const deleteAccountInputSchema = z.object({ confirmEmail: emailSchema })

export type Account = z.infer<typeof accountSchema>
export type AccountExport = z.infer<typeof accountExportSchema>
