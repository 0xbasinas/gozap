import { describe, expect, it } from 'vitest'
import { DELETION_COOLING_OFF_DAYS, cancelDeletionInputSchema, deletionDate } from './deletion'

describe('deletionDate', () => {
  it('is the cooling-off period after the request', () => {
    expect(deletionDate(0)).toBe(DELETION_COOLING_OFF_DAYS * 86_400_000)
  })
})

describe('cancelDeletionInputSchema', () => {
  it('needs a token of a plausible length', () => {
    expect(cancelDeletionInputSchema.safeParse({ token: 'a'.repeat(43) }).success).toBe(true)
    expect(cancelDeletionInputSchema.safeParse({ token: 'short' }).success).toBe(false)
    expect(cancelDeletionInputSchema.safeParse({}).success).toBe(false)
  })
})
