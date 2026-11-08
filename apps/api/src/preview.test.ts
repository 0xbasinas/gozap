import { describe, expect, it } from 'vitest'
import type { Bindings } from './env'
import { withPreviewUrl } from './preview'

const env = { BETTER_AUTH_URL: 'https://app.example.com' } as Bindings
const request = new Request('https://pr-7-app.me.workers.dev/api/health')

describe('withPreviewUrl', () => {
  it('leaves production alone', () => {
    expect(withPreviewUrl(request, env)).toBe(env)
    expect(withPreviewUrl(request, { ...env, PREVIEW: 'false' }).BETTER_AUTH_URL).toBe(
      'https://app.example.com'
    )
  })
  it('uses the address the preview is served from', () => {
    expect(withPreviewUrl(request, { ...env, PREVIEW: 'true' }).BETTER_AUTH_URL).toBe(
      'https://pr-7-app.me.workers.dev'
    )
  })
})
