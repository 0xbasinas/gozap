import { describe, expect, it } from 'vitest'
import { allowedOrigins } from './origin'

describe('allowedOrigins', () => {
  it('includes the site and the extra origins, as bare origins', () => {
    expect(
      allowedOrigins({
        BETTER_AUTH_URL: 'https://app.example.com/',
        TRUSTED_ORIGINS: ' https://a.example.com , ,myapp://'
      })
    ).toEqual(['https://app.example.com', 'https://a.example.com', 'myapp://'])
  })
  it('works without extras', () => {
    expect(allowedOrigins({ BETTER_AUTH_URL: 'http://localhost:8787' })).toEqual([
      'http://localhost:8787'
    ])
  })
})
