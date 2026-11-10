import { type JSX } from 'react'
import { authClient } from '../lib/auth'

/** Shown to staff who are viewing the site as a person, with a way back. */
export function ImpersonationBanner(): JSX.Element | null {
  const { data: session } = authClient.useSession()
  const impersonating = Boolean(
    (session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy
  )
  if (!impersonating) return null
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 bg-muted px-4 py-2 text-sm"
    >
      You are signed in as {session?.user.email} to help them.
      <button
        type="button"
        className="underline"
        onClick={() =>
          void authClient.admin.stopImpersonating().then(() => window.location.assign('/admin'))
        }
      >
        Stop
      </button>
    </div>
  )
}
