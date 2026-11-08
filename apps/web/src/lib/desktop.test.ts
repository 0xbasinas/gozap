import { describe, expect, it } from 'vitest'
import { readDesktopParams } from './desktop'

describe('readDesktopParams', () => {
  it('returns the three parameters from the desktop app', () => {
    const p = new URLSearchParams('client_id=electron&code_challenge=abc&state=xyz&other=1')
    expect(readDesktopParams(p)).toEqual({
      client_id: 'electron',
      code_challenge: 'abc',
      state: 'xyz'
    })
  })
  it('returns null for a normal visit or an incomplete or foreign request', () => {
    expect(readDesktopParams(new URLSearchParams(''))).toBeNull()
    expect(readDesktopParams(new URLSearchParams('client_id=electron&state=x'))).toBeNull()
    expect(
      readDesktopParams(new URLSearchParams('client_id=other&code_challenge=a&state=b'))
    ).toBeNull()
  })
})
