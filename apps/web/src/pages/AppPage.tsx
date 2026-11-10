import { type JSX } from 'react'
import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router'
import { authClient } from '../lib/auth'
import { TodosSection } from '../components/TodosSection'

/** The signed-in home of the web app. Replace it with your product; sign-in, the API and the database are already wired up. */
export function AppPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  const me = session?.user.id
  const activeId = (session?.session as { activeOrganizationId?: string | null } | undefined)
    ?.activeOrganizationId
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])
  const teamName = teams.find((t) => t.id === activeId)?.name ?? null

  useEffect(() => {
    if (!me) return
    let cancelled = false
    void authClient.organization.list().then(({ data }) => {
      if (!cancelled) setTeams((data ?? []) as { id: string; name: string }[])
    })
    return () => {
      cancelled = true
    }
  }, [me])

  if (isPending) return <p className="text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-bold tracking-tight">Web app</h1>
      <p className="text-sm text-muted-foreground">Signed in as {session.user.email}</p>
      <p className="text-sm text-muted-foreground">
        Workspace: <span className="font-medium text-foreground">{teamName ?? 'Personal'}</span>.{' '}
        <Link to="/teams" className="underline">
          {teamName ? 'Manage this team' : 'Create or join a team'}
        </Link>
      </p>
      <div className="pt-6">
        <TodosSection
          workspaceKey={activeId ?? 'personal'}
          workspaceName={teamName ?? 'Personal'}
        />
      </div>
    </div>
  )
}
