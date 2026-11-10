import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Navigate } from 'react-router'
import { authClient } from '../lib/auth'
import { DirectorySyncSection } from '../components/DirectorySyncSection'
import { SsoAdminSection } from '../components/SsoAdminSection'

interface Team {
  id: string
  name: string
}
interface Member {
  id: string
  userId: string
  role: string
  user: { email: string; name: string }
}
interface Invite {
  id: string
  email: string
  role: string
  status: string
}
interface Full extends Team {
  members: Member[]
  invitations: Invite[]
}

const slugFor = (name: string): string =>
  `${name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30)}-${crypto.randomUUID().slice(0, 6)}`

/** Teams: people who share a workspace. Owners and admins invite by email; anyone but the owner can leave. */
export function TeamsPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  const me = session?.user.id
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [full, setFull] = useState<Full | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
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

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void authClient.organization
      .getFullOrganization({ query: { organizationId: open } })
      .then(({ data }) => {
        if (!cancelled) setFull((data as Full | null) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [open, reload])

  if (isPending) return <p role="status">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />

  const mine = full?.members.find((m) => m.userId === me)?.role ?? ''
  const manages = mine.includes('owner') || mine.includes('admin')
  const owns = mine.includes('owner')

  async function run(action: Promise<{ error: { message?: string } | null }>): Promise<void> {
    const { error: failure } = await action
    setError(failure ? (failure.message ?? 'That did not work.') : null)
    setReload((n) => n + 1)
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return
    await run(authClient.organization.create({ name: name.trim(), slug: slugFor(name) }))
    setName('')
  }

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!full || !email.trim()) return
    await run(
      authClient.organization.inviteMember({
        email: email.trim(),
        role: 'member',
        organizationId: full.id
      })
    )
    setEmail('')
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
            <span>{t.name}</span>
            <Button variant="outline" size="sm" onClick={() => setOpen(t.id)}>
              Open
            </Button>
          </li>
        ))}
      </ul>
      {full && open === full.id && (
        <section className="space-y-3" aria-label={`Team ${full.name}`}>
          <h2 className="text-lg font-semibold">{full.name}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {full.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between p-3 text-sm">
                <span>
                  {m.user.email} <span className="text-muted-foreground">({m.role})</span>
                </span>
                {manages && m.userId !== me && !m.role.includes('owner') && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(
                        authClient.organization.removeMember({
                          memberIdOrEmail: m.id,
                          organizationId: full.id
                        })
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {full.invitations
            .filter((i) => i.status === 'pending')
            .map((i) => (
              <p key={i.id} className="flex items-center justify-between text-sm">
                <span>Invited: {i.email}</span>
                {manages && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      void run(authClient.organization.cancelInvitation({ invitationId: i.id }))
                    }
                  >
                    Cancel invite
                  </Button>
                )}
              </p>
            ))}
          {manages && (
            <form onSubmit={(e) => void invite(e)} className="flex gap-2">
              <input
                aria-label="Email to invite"
                type="email"
                placeholder="Email to invite"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="submit" variant="outline">
                Send invitation
              </Button>
            </form>
          )}
          {manages && <SsoAdminSection organizationId={full.id} />}
          {owns && <DirectorySyncSection organizationId={full.id} />}
          {owns ? (
            <Button
              variant="outline"
              onClick={() => {
                void run(authClient.organization.delete({ organizationId: full.id }))
                setOpen(null)
                setFull(null)
              }}
            >
              Delete team
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                void run(authClient.organization.leave({ organizationId: full.id }))
                setOpen(null)
                setFull(null)
              }}
            >
              Leave team
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
