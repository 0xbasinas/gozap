import { z } from 'zod'
import { consentEventSchema } from './consents'
import { dataRequestSchema } from './dataRequests'
import { signInSchema } from './signIns'
import { feedbackExportSchema } from './feedback'
import { preferencesRecordSchema } from './preferences'

/** An email address, normalised the same way everywhere (trimmed, lower case). */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))

/** The signed-in person, as shown on the account page. */
export const accountSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  createdAt: z.string(),
  /** When the account will be removed if the person asked for that and has not cancelled; otherwise null. */
  deletionScheduledFor: z.string().nullable().default(null),
  /** An address the person asked to move to and has not confirmed yet; otherwise null. */
  pendingEmail: z.string().nullable().default(null)
})

/** One security event about the account: a sign-in, a failed attempt, a revoked session, a passkey change. */
export const securityEventSchema = z.object({
  at: z.string(),
  type: z.string(),
  outcome: z.string(),
  label: z.string().nullable(),
  ipAddress: z.string().nullable()
})
export const securityEventsSchema = z.array(securityEventSchema)
export type SecurityEvent = z.infer<typeof securityEventSchema>

/** An AI app (OAuth client) as staff see it in the admin page. */
export const aiAppsSchema = z.array(
  z.object({
    clientId: z.string(),
    name: z.string().nullable(),
    disabled: z.boolean(),
    people: z.number(),
    createdAt: z.string().nullable()
  })
)
export type AiApp = z.infer<typeof aiAppsSchema>[number]

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
  feedback: z.array(feedbackExportSchema).default([]),
  signInActivity: z.array(signInSchema).default([]),
  securityActivity: z.array(securityEventSchema).default([]),
  teams: z
    .array(z.object({ name: z.string(), role: z.string(), joinedAt: z.string() }))
    .default([]),
  presence: z
    .object({ visible: z.boolean(), lastSeenAt: z.string().nullable() })
    .nullable()
    .default(null),
  todos: z
    .array(
      z.object({
        team: z.string().nullable(),
        title: z.string(),
        done: z.boolean(),
        createdAt: z.string()
      })
    )
    .default([]),
  directory: z
    .array(
      z.object({
        team: z.string(),
        userName: z.string(),
        externalId: z.string().nullable(),
        active: z.boolean()
      })
    )
    .default([]),
  connectedApps: z
    .array(z.object({ clientId: z.string(), scopes: z.array(z.string()), createdAt: z.string() }))
    .default([]),
  apiKeys: z
    .array(
      z.object({
        name: z.string().nullable(),
        start: z.string().nullable(),
        createdAt: z.string(),
        expiresAt: z.string().nullable()
      })
    )
    .default([]),
  dataRequests: z.array(dataRequestSchema).default([]),
  consents: z.array(consentEventSchema).default([]),
  sessions: z.array(
    z.object({
      createdAt: z.string(),
      expiresAt: z.string(),
      ipAddress: z.string().nullable(),
      userAgent: z.string().nullable(),
      nickname: z.string().nullable().default(null)
    })
  )
})

/** Deleting an account needs the email typed again, so it cannot happen by a stray click or request. */
export const deleteAccountInputSchema = z.object({ confirmEmail: emailSchema })

export type Account = z.infer<typeof accountSchema>
export type AccountExport = z.infer<typeof accountExportSchema>
