import { useEffect, useState, type JSX } from 'react'
import type { SecurityEvent } from '@repo/shared'
import { api } from '../lib/api'

const NAMES: Record<string, string> = {
  user_signed_in: 'Signed in',
  user_sign_in_failed: 'Sign-in failed',
  session_revoked: 'A device was signed out',
  all_sessions_revoked: 'Other devices were signed out',
  profile_updated: 'Profile changed',
  passkey_added: 'Passkey added',
  passkey_removed: 'Passkey removed',
  api_key_created: 'API key made',
  api_key_deleted: 'API key deleted',
  user_banned: 'Account suspended',
  user_unbanned: 'Account restored',
  user_role_updated: 'Role changed',
  user_impersonated: 'Staff signed in as you to help',
  user_impersonated_stopped: 'Staff stopped helping',
  email_changed: 'Email changed',
  team_created: 'Team created',
  team_deleted: 'Team deleted',
  team_left: 'Left a team',
  member_invited: 'Someone was invited to a team',
  invitation_accepted: 'Joined a team',
  member_removed: 'A team member was removed',
  team_role_changed: 'A team role was changed'
}

const eventName = (type: string): string => NAMES[type] ?? type.replaceAll('_', ' ')

/** Security events about the account: sign-ins and failures, signed-out devices, passkey and key changes, staff actions. */
export function SecurityActivitySection(): JSX.Element {
  const [events, setEvents] = useState<SecurityEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.account
      .securityActivity()
      .then((list) => {
        if (!cancelled) setEvents(list)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setError('Could not load your security activity.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="space-y-2" aria-label="Security activity">
      <h2 className="text-lg font-semibold">Security activity</h2>
      <p className="text-sm text-muted-foreground">
        Changes and failed attempts on your account, newest first. Kept for a year.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {events?.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {events?.map((e) => (
          <li key={`${e.at}-${e.type}`} className="px-4 py-2 text-sm">
            <span className="font-medium">{eventName(e.type)}</span>
            {e.outcome === 'failure' && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Failed</span>
            )}
            <p className="text-xs text-muted-foreground">
              {new Date(e.at).toLocaleString()}
              {e.label ? ` · ${e.label}` : ''}
              {e.ipAddress ? ` · ${e.ipAddress}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
