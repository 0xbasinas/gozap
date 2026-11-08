import { describe, expect, it } from 'vitest'
import { parseAuthCallback } from './authLink'

const S = 'my-app'

describe('parseAuthCallback', () => {
  it('reads the code from both link shapes', () => {
    expect(parseAuthCallback('my-app:/auth/callback#token=abc_DEF-123', S)).toBe('abc_DEF-123')
    expect(parseAuthCallback('my-app://auth/callback#token=abc', S)).toBe('abc')
  })

  it('ignores other schemes, paths and links without a code', () => {
    expect(parseAuthCallback('other:/auth/callback#token=abc', S)).toBeNull()
    expect(parseAuthCallback('my-app:/open/42#token=abc', S)).toBeNull()
    expect(parseAuthCallback('my-app:/auth/callback', S)).toBeNull()
    expect(parseAuthCallback('my-app:/auth/callback#other=abc', S)).toBeNull()
    expect(parseAuthCallback('not a url', S)).toBeNull()
  })

  it('refuses codes with unexpected characters or that are far too long', () => {
    expect(parseAuthCallback('my-app:/auth/callback#token=a b', S)).toBeNull()
    expect(parseAuthCallback('my-app:/auth/callback#token=a/../b', S)).toBeNull()
    expect(parseAuthCallback(`my-app:/auth/callback#token=${'a'.repeat(2049)}`, S)).toBeNull()
  })
})
