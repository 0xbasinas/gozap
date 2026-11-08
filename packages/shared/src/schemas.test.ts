import { describe, expect, it } from 'vitest'
import { deleteAccountInputSchema, emailSchema } from './schemas'

describe('emailSchema', () => {
  it('trims and lower-cases', () => {
    expect(emailSchema.parse('  Me@Example.COM ')).toBe('me@example.com')
  })
  it('rejects things that are not emails', () => {
    expect(emailSchema.safeParse('nope').success).toBe(false)
    expect(emailSchema.safeParse('a@b').success).toBe(false)
  })
})

describe('deleteAccountInputSchema', () => {
  it('normalises the confirmation email', () => {
    expect(deleteAccountInputSchema.parse({ confirmEmail: ' Me@Example.com ' })).toEqual({
      confirmEmail: 'me@example.com'
    })
    expect(deleteAccountInputSchema.safeParse({ confirmEmail: 'nope' }).success).toBe(false)
  })
})
