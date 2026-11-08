import { type JSX } from 'react'
import { Navigate } from 'react-router'
import { authClient } from '../lib/auth'

/** The signed-in home of the web app. Replace it with your product; sign-in, the API and the database are already wired up. */
export function AppPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()

  if (isPending) return <p className="text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">Web app</h1>
      <p className="text-sm text-muted-foreground">Signed in as {session.user.email}</p>
    </div>
  )
}
