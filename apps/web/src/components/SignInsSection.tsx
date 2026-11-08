import { useEffect, useState, type JSX } from 'react'
import type { SignIn } from '@repo/shared'
import { api } from '../lib/api'

/** The latest sign-ins to the account. A sign-in from a new browser and system is marked, and also emailed. */
export function SignInsSection(): JSX.Element {
  const [signIns, setSignIns] = useState<SignIn[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.account
      .signIns()
      .then((list) => {
        if (!cancelled) setSignIns(list)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setError('Could not load your sign-ins.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="space-y-2" aria-label="Recent sign-ins">
      <h2 className="text-lg font-semibold">Recent sign-ins</h2>
      <p className="text-sm text-muted-foreground">
        The last times someone signed in. We email you when it is from a new device. Do not
        recognise one? Sign out everywhere above.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {signIns?.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {signIns?.map((s) => (
          <li key={`${s.at}-${s.label}`} className="px-4 py-2 text-sm">
            <span className="font-medium">{s.label}</span>
            {s.newDevice && (
              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">New</span>
            )}
            <p className="text-xs text-muted-foreground">
              {new Date(s.at).toLocaleString()}
              {s.ipAddress ? ` · ${s.ipAddress}` : ''}
            </p>
          </li>
        ))}
      </ul>
    </section>
  )
}
