import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button, buttonVariants } from '@repo/ui'
import { Link, Navigate, useNavigate } from 'react-router'
import { authClient } from '../lib/auth'

interface Team {
  id: string
  name: string
  slug: string
}

const slugFor = (name: string): string =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)}-${crypto.randomUUID().slice(0, 6)}`

/** Your teams. A team is a workspace: pick one as active, or open it to see its people and settings. */
export function TeamsPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  const me = session?.user.id
  const activeId = (session?.session as { activeOrganizationId?: string | null } | undefined)
    ?.activeOrganizationId
  const navigate = useNavigate()
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!me) return
    let cancelled = false
    void authClient.organization.list().then(({ data }) => {
      if (!cancelled) setTeams((data ?? []) as Team[])
    })
    return () => {
      cancelled = true
    }
  }, [me, reload])

  if (isPending) return <p role="status">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />

  async function run(action: Promise<{ error: { message?: string } | null }>): Promise<boolean> {
    const { error: failure } = await action
    setError(failure ? (failure.message ?? 'That did not work.') : null)
    setReload((n) => n + 1)
    return !failure
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    const title = name.trim()
    if (!title) return
    const slug = slugFor(title)
    const ok = await run(authClient.organization.create({ name: title, slug }))
    setName('')
    // A new team becomes the active workspace; take the person to it.
    if (ok) void navigate(`/teams/${slug}`)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Teams</h1>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form onSubmit={(e) => void create(e)} className="flex gap-2">
        <input
          aria-label="Team name"
          placeholder="Name a new team"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Create team
        </Button>
      </form>
      {teams?.length === 0 && <p className="text-sm text-muted-foreground">No teams yet.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {teams?.map((t) => (
          <li key={t.id} className="flex items-center justify-between p-3 text-sm">
            <span>
              {t.name}
              {activeId === t.id && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs">
                  Active workspace
                </span>
              )}
            </span>
            <span className="flex gap-2">
              {activeId !== t.id && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Use ${t.name} as workspace`}
                  onClick={() =>
                    void run(authClient.organization.setActive({ organizationId: t.id }))
                  }
                >
                  Use
                </Button>
              )}
              <Link
                to={`/teams/${t.slug}`}
                aria-label={`Open ${t.name}`}
                className={buttonVariants({ variant: 'outline', size: 'sm' })}
              >
                Open
              </Link>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
