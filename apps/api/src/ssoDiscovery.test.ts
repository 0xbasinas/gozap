import { describe, expect, it } from 'vitest'
import { DiscoveryError, discoverIssuer, publicHttps } from './ssoDiscovery'

const doc = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  issuer: 'https://acme.okta.example',
  authorization_endpoint: 'https://acme.okta.example/oauth2/v1/authorize',
  token_endpoint: 'https://acme.okta.example/oauth2/v1/token',
  jwks_uri: 'https://acme.okta.example/oauth2/v1/keys',
  userinfo_endpoint: 'https://acme.okta.example/oauth2/v1/userinfo',
  token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
  ...extra
})
const fake = (body: unknown, status = 200): typeof fetch =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status
    })) as unknown as typeof fetch

describe('publicHttps', () => {
  it('accepts public https hosts and refuses everything else', () => {
    expect(publicHttps('https://acme.okta.example/x', 'a').hostname).toBe('acme.okta.example')
    for (const bad of [
      'http://acme.example',
      'https://localhost',
      'https://127.0.0.1',
      'https://10.0.0.1/x',
      'https://[::1]/',
      'https://intranet',
      'https://box.internal',
      'https://u:p@acme.example',
      'https://acme.example:8443',
      'not a url'
    ])
      expect(() => publicHttps(bad, 'a'), bad).toThrow(DiscoveryError)
  })
})

describe('discoverIssuer', () => {
  it('reads the endpoints', async () => {
    const found = await discoverIssuer('https://acme.okta.example/', fake(doc()))
    expect(found).toMatchObject({
      tokenEndpoint: 'https://acme.okta.example/oauth2/v1/token',
      jwksEndpoint: 'https://acme.okta.example/oauth2/v1/keys',
      tokenEndpointAuthMethods: ['client_secret_basic', 'client_secret_post']
    })
  })
  it('refuses a mismatched issuer, a missing or private endpoint, and bad answers', async () => {
    const run = (
      body: unknown,
      status = 200,
      issuer = 'https://acme.okta.example'
    ): Promise<unknown> => discoverIssuer(issuer, fake(body, status))
    await expect(run(doc({ issuer: 'https://evil.example' }))).rejects.toThrow()
    await expect(run(doc({ jwks_uri: undefined }))).rejects.toThrow()
    await expect(run(doc({ token_endpoint: 'https://169.254.169.254/token' }))).rejects.toThrow()
    await expect(run('<html>')).rejects.toThrow()
    await expect(run({}, 404)).rejects.toThrow()
    await expect(run(doc(), 200, 'http://acme.okta.example')).rejects.toThrow()
  })
})
