import { z } from 'zod'

/** The time the law gives to answer a request about personal data (GDPR: one month). The page shows the deadline. */
export const DATA_REQUEST_DEADLINE_DAYS = 30

export const DATA_REQUEST_KINDS = ['export', 'deletion'] as const
/** received: logged. processing: being worked on (a deletion waiting out its cooling-off period). done / cancelled: finished. */
export const DATA_REQUEST_STATUSES = ['received', 'processing', 'done', 'cancelled'] as const

export const dataRequestSchema = z.object({
  kind: z.enum(DATA_REQUEST_KINDS),
  status: z.enum(DATA_REQUEST_STATUSES),
  receivedAt: z.string(),
  /** The date by which the request must be answered. */
  dueAt: z.string(),
  completedAt: z.string().nullable()
})

export const dataRequestsSchema = z.array(dataRequestSchema)

export type DataRequest = z.infer<typeof dataRequestSchema>

/** When a request received at `now` (ms since 1970) must be answered. */
export const dataRequestDeadline = (now: number): number =>
  now + DATA_REQUEST_DEADLINE_DAYS * 86_400_000
