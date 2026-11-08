import { describe, expect, it } from 'vitest'
import { suppressionsFrom } from './suppression'

describe('suppressionsFrom', () => {
  it('suppresses permanent bounces and complaints, lower-cased', () => {
    expect(
      suppressionsFrom({
        type: 'email.bounced',
        data: { to: [' A@B.com '], bounce: { type: 'Permanent' } }
      })
    ).toEqual([{ address: 'a@b.com', reason: 'bounced' }])
    expect(suppressionsFrom({ type: 'email.complained', data: { to: ['c@d.com'] } })).toEqual([
      { address: 'c@d.com', reason: 'complained' }
    ])
  })

  it('ignores everything else', () => {
    expect(
      suppressionsFrom({
        type: 'email.bounced',
        data: { to: ['a@b.com'], bounce: { type: 'Transient' } }
      })
    ).toEqual([])
    expect(suppressionsFrom({ type: 'email.bounced', data: { to: ['a@b.com'] } })).toEqual([])
    expect(suppressionsFrom({ type: 'email.delivered', data: { to: ['a@b.com'] } })).toEqual([])
    expect(
      suppressionsFrom({ type: 'email.complained', data: { to: ['not-an-address'] } })
    ).toEqual([])
    expect(suppressionsFrom(null)).toEqual([])
    expect(suppressionsFrom('x')).toEqual([])
  })
})
