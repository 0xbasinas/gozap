import { useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { useNavigate, useParams } from 'react-router'
import { authClient } from '../lib/auth'

/** The page an invitation email points to. The person signs in with the invited address, then accepts. */
export function AcceptInvitationPage(): JSX.Element {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const [team, setTeam] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const signedIn = Boolean(session)

  useEffect(() => {
    if (!signedIn) return
    let cancelled = false
    void authClient.organization
      .getInvitation({ query: { id } })
      .then(({ data, error: failure }) => {
        if (cancelled) return
        if (failure || !data)
          setError('This invitation is not for this account, or it has expired.')
        else setTeam((data as { organizationName?: string }).organizationName ?? 'this team')
      })
    return () => {
      cancelled = true
    }
  }, [signedIn, id])

  if (isPending) return <p role="status">Loading...</p>
  if (!session) {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">You have been invited</h1>
        <p className="text-muted-foreground">
          Sign in with the email address the invitation was sent to, then come back to this link.
        </p>
        <Button
          onClick={() =>
            void navigate(`/sign-in?next=${encodeURIComponent(`/accept-invitation/${id}`)}`)
          }
        >
          Sign in
        </Button>
      </div>
    )
  }

  async function accept(): Promise<void> {
    setBusy(true)
    const { error: failure } = await authClient.organization.acceptInvitation({ invitationId: id })
    setBusy(false)
    if (failure) setError('Could not join. The invitation may be for a different address.')
    else void navigate('/teams')
  }

  if (error && !team) {
    return (
      <p role="alert" className="text-destructive">
        {error}
      </p>
    )
  }
  if (!team) return <p role="status">Loading...</p>
  return (
    <div className="mx-auto max-w-sm space-y-3">
      <h1 className="text-2xl font-bold tracking-tight">Join {team}?</h1>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button disabled={busy} onClick={() => void accept()}>
        Accept invitation
      </Button>
    </div>
  )
}
