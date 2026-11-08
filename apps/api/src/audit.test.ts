import { describe, expect, it } from 'vitest'
import { eventForCall } from './audit'

describe('eventForCall', () => {
  it('records a bad magic link as a failed sign-in, and a good one as nothing (the session hook covers it)', () => {
    expect(
      eventForCall({
        path: '/magic-link/verify',
        failed: false,
        location: '/sign-in?error=INVALID_TOKEN'
      })
    ).toMatchObject({ type: 'user_sign_in_failed', outcome: 'failure' })
    expect(eventForCall({ path: '/magic-link/verify', failed: false, location: '/app' })).toBeNull()
  })

  it('records a failed passkey sign-in with its code', () => {
    expect(
      eventForCall({
        path: '/passkey/verify-authentication',
        failed: true,
        errorCode: 'AUTHENTICATION_FAILED'
      })
    ).toEqual({ type: 'user_sign_in_failed', outcome: 'failure', code: 'AUTHENTICATION_FAILED' })
  })

  it('records session and profile changes only when they worked', () => {
    expect(eventForCall({ path: '/revoke-sessions', failed: false })?.type).toBe(
      'all_sessions_revoked'
    )
    expect(eventForCall({ path: '/update-user', failed: true })).toBeNull()
  })

  it('records a refused admin action', () => {
    expect(
      eventForCall({ path: '/admin/ban-user', failed: true, errorCode: 'FORBIDDEN' })
    ).toMatchObject({ type: 'user_banned', outcome: 'failure' })
  })

  it('records a changed team role', () => {
    expect(eventForCall({ path: '/organization/update-member-role', failed: false })?.type).toBe(
      'team_role_changed'
    )
  })

  it('ignores everything else', () => {
    expect(eventForCall({ path: '/get-session', failed: false })).toBeNull()
  })
})
