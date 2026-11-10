import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { authClient } from '../lib/auth'
import { DirectorySyncSection } from '../components/DirectorySyncSection'
import { SsoAdminSection } from '../components/SsoAdminSection'

interface Member {
  id: string
  userId: string
  role: string
  createdAt?: string | Date
  user: { email: string; name: string }
}
interface Invite {
  id: string
  email: string
  role: string
  status: string
  createdAt?: string | Date
}
interface Team {
  id: string
  name: string
  slug: string
  members: Member[]
  invitations: Invite[]
}

const day = (value: string | Date | undefined): string =>
  value ? new Date(value).toLocaleDateString() : ''

/** One team: its people, invitations, recent changes, and (for owners) settings. The Teams page lists the teams. */
export function TeamPage(): JSX.Element {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const { data: session, isPending } = authClient.useSession()
  const me = session?.user.id
  const activeId = (session?.session as { activeOrganizationId?: string | null } | undefined)
    ?.activeOrganizationId
  const [team, setTeam] = useState<Team | null | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [rename, setRename] = useState('')
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!me) return
    let cancelled = false
    void authClient.organization
      .getFullOrganization({ query: { organizationSlug: slug } })
      .then(({ data }) => {
        if (!cancelled) setTeam((data as Team | null) ?? null)
      })
    return () => {
      cancelled = true
    }
  }, [me, slug, reload])

  if (isPending || (session && team === undefined)) return <p role="status">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  if (!team)
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Team not found</h1>
        <Link to="/teams" className="text-sm underline">
          Back to your teams
        </Link>
      </div>
    )

  const mine = team.members.find((m) => m.userId === me)?.role ?? ''
  const owns = mine.includes('owner')
  const manages = owns || mine.includes('admin')
  const owners = team.members.filter((m) => m.role.includes('owner')).length
  const active = activeId === team.id
  const pending = team.invitations.filter((i) => i.status === 'pending')
  const feed = [
    ...team.members.map((m) => ({
      key: `m${m.id}`,
      at: m.createdAt,
      text: `${m.user.name || m.user.email} joined`
    })),
    ...pending.map((i) => ({ key: `i${i.id}`, at: i.createdAt, text: `${i.email} was invited` }))
  ]
    .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
    .slice(0, 8)

  async function run(action: Promise<{ error: { message?: string } | null }>): Promise<boolean> {
    const { error: failure } = await action
    setError(failure ? (failure.message ?? 'That did not work.') : null)
    setReload((n) => n + 1)
    return !failure
  }

  async function invite(event: FormEvent): Promise<void> {
    event.preventDefault()
    const current = team
    if (!current || !email.trim()) return
    await run(
      authClient.organization.inviteMember({
        email: email.trim(),
        role: 'member',
        organizationId: current.id
      })
    )
    setEmail('')
  }

  async function renameTeam(event: FormEvent): Promise<void> {
    event.preventDefault()
    const current = team
    if (!current || !rename.trim()) return
    await run(
      authClient.organization.update({ data: { name: rename.trim() }, organizationId: current.id })
    )
    setRename('')
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/teams" className="text-sm text-muted-foreground underline">
          All teams
        </Link>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight">{team.name}</h1>
          {active ? (
            <span className="rounded-full bg-muted px-3 py-1 text-xs">Active workspace</span>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void run(authClient.organization.setActive({ organizationId: team.id }))
              }
            >
              Use as my workspace
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {team.members.length} {team.members.length === 1 ? 'person' : 'people'}. You are{' '}
          {mine || 'a member'}.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-3" aria-label="People">
        <h2 className="text-lg font-semibold">People</h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {team.members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span className="min-w-0 truncate">
                {m.user.email} <span className="text-muted-foreground">({m.role})</span>
              </span>
              <span className="flex shrink-0 gap-2">
                {owns && m.userId !== me && !m.role.includes('owner') && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Make ${m.user.email} an owner`}
                    onClick={() =>
                      void run(
                        authClient.organization.updateMemberRole({
                          memberId: m.id,
                          role: 'owner',
                          organizationId: team.id
                        })
                      )
                    }
                  >
                    Make owner
                  </Button>
                )}
                {manages && m.userId !== me && !m.role.includes('owner') && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Remove ${m.user.email}`}
                    onClick={() =>
                      void run(
                        authClient.organization.removeMember({
                          memberIdOrEmail: m.id,
                          organizationId: team.id
                        })
                      )
                    }
                  >
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
        {pending.map((i) => (
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
      </section>

      {feed.length > 0 && (
        <section className="space-y-2" aria-label="Recent activity">
          <h2 className="text-lg font-semibold">Recent activity</h2>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {feed.map((f) => (
              <li key={f.key}>
                {f.text}
                {f.at ? `, ${day(f.at)}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {manages && <SsoAdminSection organizationId={team.id} />}
      {owns && <DirectorySyncSection organizationId={team.id} />}

      {owns && (
        <section className="space-y-3" aria-label="Team settings">
          <h2 className="text-lg font-semibold">Settings</h2>
          <form onSubmit={(e) => void renameTeam(e)} className="flex gap-2">
            <input
              aria-label="New team name"
              placeholder={team.name}
              value={rename}
              maxLength={60}
              onChange={(e) => setRename(e.target.value)}
              className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            />
            <Button type="submit" variant="outline">
              Rename team
            </Button>
          </form>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">Delete this team</p>
            <p className="text-sm text-muted-foreground">
              This removes the team, its to-do list and its company sign-in for everyone. Type{' '}
              <strong>{team.name}</strong> to confirm.
            </p>
            <div className="flex gap-2">
              <input
                aria-label="Type the team name to confirm"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button
                variant="outline"
                disabled={typed !== team.name}
                onClick={() =>
                  void run(authClient.organization.delete({ organizationId: team.id })).then(
                    (ok) => {
                      if (ok) void navigate('/teams')
                    }
                  )
                }
              >
                Delete team
              </Button>
            </div>
          </div>
        </section>
      )}

      {(!owns || owners > 1) && (
        <Button
          variant="outline"
          onClick={() =>
            void run(authClient.organization.leave({ organizationId: team.id })).then((ok) => {
              if (ok) void navigate('/teams')
            })
          }
        >
          Leave team
        </Button>
      )}
      {owns && owners === 1 && (
        <p className="text-sm text-muted-foreground">
          You are the only owner. Make someone else an owner before you leave, or delete the team.
        </p>
      )}
    </div>
  )
}
