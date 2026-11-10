import { describe, expect, it } from 'vitest'

// RFC 9116: Contact and Expires are required. (Expires must be renewed at least yearly; see docs/api/operations.md.)
import text from '../public/.well-known/security.txt?raw'

describe('security.txt', () => {
  it('has a contact and a valid expiry date', () => {
    expect(text).toMatch(/^Contact: https:\/\/\S+$/m)
    const expires = /^Expires: (\S+)$/m.exec(text)?.[1]
    expect(expires && !Number.isNaN(Date.parse(expires))).toBe(true)
  })
})
