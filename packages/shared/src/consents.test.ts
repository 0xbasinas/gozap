import { describe, expect, it } from 'vitest'
import { currentConsents, setConsentInputSchema, type ConsentEvent } from './consents'

const e = (purpose: ConsentEvent['purpose'], granted: boolean, at: string): ConsentEvent => ({
  purpose,
  granted,
  policyVersion: 'v',
  at
})

describe('consents', () => {
  it('takes the newest answer per purpose', () => {
    const history = [
      e('product-emails', false, '3'),
      e('crash-reports', true, '2'),
      e('product-emails', true, '1')
    ]
    expect(currentConsents(history)).toEqual({ 'product-emails': false, 'crash-reports': true })
  })
  it('is empty with no history', () => expect(currentConsents([])).toEqual({}))
  it('rejects unknown purposes', () => {
    expect(setConsentInputSchema.safeParse({ purpose: 'ads', granted: true }).success).toBe(false)
    expect(
      setConsentInputSchema.safeParse({ purpose: 'crash-reports', granted: true }).success
    ).toBe(true)
  })
})
