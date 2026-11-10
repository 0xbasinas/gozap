import { describe, expect, it } from 'vitest'
import auth from '../node_modules/better-auth/package.json'
import apiKey from '../node_modules/@better-auth/api-key/package.json'
import cimd from '../node_modules/@better-auth/cimd/package.json'
import drizzle from '../node_modules/@better-auth/drizzle-adapter/package.json'
import electron from '../node_modules/@better-auth/electron/package.json'
import mcp from '../node_modules/@better-auth/mcp/package.json'
import oauthProvider from '../node_modules/@better-auth/oauth-provider/package.json'
import passkey from '../node_modules/@better-auth/passkey/package.json'
import sso from '../node_modules/@better-auth/sso/package.json'

// Better Auth 1.8 is a beta with changes to the plugins we rely on (SSO, MCP, SCIM hooks that D1 blocks). A "^1.7.x"
// range would pick it up on its own, so this fails the build until someone reads the release notes and moves on purpose.
describe('Better Auth version', () => {
  it('every Better Auth package is on 1.7.x', () => {
    const installed = {
      'better-auth': auth.version,
      api: apiKey.version,
      cimd: cimd.version,
      drizzle: drizzle.version,
      electron: electron.version,
      mcp: mcp.version,
      oauthProvider: oauthProvider.version,
      passkey: passkey.version,
      sso: sso.version
    }
    for (const [name, version] of Object.entries(installed))
      expect(version, name).toMatch(/^1\.7\.\d+$/)
  })
})
