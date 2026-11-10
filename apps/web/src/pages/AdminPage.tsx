import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { securityEventsSchema, type SecurityEvent } from '@repo/shared'
import { Navigate } from 'react-router'
import { AiAppsAdminSection } from '../components/AiAppsAdminSection'
import { SsoAdminSection } from '../components/SsoAdminSection'
import { authClient } from '../lib/auth'

interface Person {
  id: string
  email: string
  name: string
  role?: string | null
  banned?: boolean | null
  banReason?: string | null
}

const PAGE = 25

/** Staff only. `admin` can suspend people; `support` can look. The server enforces both, this page only hides buttons. */
export function AdminPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  const role = (session?.user as { role?: string | null } | undefined)?.role ?? null
  const staff = role === 'admin' || role === 'support'
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [people, setPeople] = useState<Person[]>([])
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const [reload, setReload] = useState(0)
  const [activityOf, setActivityOf] = useState<Person | null>(null)
  const [activity, setActivity] = useState<SecurityEvent[] | null>(null)

  useEffect(() => {
    if (!staff) return
    void authClient.admin
      .listUsers({
        query: {
          limit: PAGE,
          offset: page * PAGE,
          sortBy: 'createdAt',
          sortDirection: 'desc',
          ...(search.trim()
            ? { searchValue: search.trim(), searchField: 'email', searchOperator: 'contains' }
            : {})
        }
      })
      .then(({ data, error: failure }) => {
        if (failure || !data) {
          setError('Could not load people.')
          return
        }
        setError(null)
        setPeople(data.users as Person[])
        setTotal(data.total)
      })
  }, [staff, page, search, reload])

  if (isPending) return <p role="status">Loading...</p>
  if (!staff) return <Navigate to="/" replace />

  async function toggleBan(person: Person): Promise<void> {
    const { error: failure } = person.banned
      ? await authClient.admin.unbanUser({ userId: person.id })
      : await authClient.admin.banUser({ userId: person.id, banReason: 'Suspended by staff' })
    if (failure) setError('That did not work.')
    else setReload((n) => n + 1)
  }

  async function showActivity(person: Person): Promise<void> {
    setActivityOf(person)
    setActivity(null)
    const response = await fetch(`/api/admin/audit/${encodeURIComponent(person.id)}`, {
      credentials: 'same-origin'
    })
    if (!response.ok) {
      setError('Could not load that activity.')
      return
    }
    setActivity(securityEventsSchema.parse(await response.json()))
  }

  async function changeRole(person: Person, next: string): Promise<void> {
    const { error: failure } = await authClient.admin.setRole({
      userId: person.id,
      role: next as 'user' | 'admin'
    })
    if (failure) setError('That did not work.')
    else setReload((n) => n + 1)
  }

  async function signInAs(person: Person): Promise<void> {
    const { error: failure } = await authClient.admin.impersonateUser({ userId: person.id })
    if (failure) setError('That did not work.')
    else window.location.assign('/account')
  }

  function submit(event: FormEvent): void {
    event.preventDefault()
    setPage(0)
  }

  const pages = Math.max(1, Math.ceil(total / PAGE))
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">People</h1>
      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label="Search by email"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value)
            setPage(0)
          }}
          placeholder="Search by email"
          className="h-9 w-full max-w-sm rounded-md border border-input bg-background px-3 text-sm"
        />
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr>
            <th className="py-2">Email</th>
            <th>Role</th>
            <th>Status</th>
            {role === 'admin' && <th />}
          </tr>
        </thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id} className="border-t border-border">
              <td className="py-2">{p.email}</td>
              <td>
                {role === 'admin' && p.id !== session?.user.id ? (
                  <select
                    aria-label={`Role of ${p.email}`}
                    value={p.role ?? 'user'}
                    onChange={(e) => void changeRole(p, e.target.value)}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="user">user</option>
                    <option value="support">support</option>
                    <option value="admin">admin</option>
                  </select>
                ) : (
                  (p.role ?? 'user')
                )}
              </td>
              <td>
                {p.banned ? 'Suspended' : 'Active'}{' '}
                <Button variant="outline" size="sm" onClick={() => void showActivity(p)}>
                  Activity
                </Button>
              </td>
              {role === 'admin' && (
                <td className="space-x-2 text-right">
                  {p.id !== session?.user.id && (
                    <>
                      {!p.banned && p.role !== 'admin' && (
                        <Button variant="outline" size="sm" onClick={() => void signInAs(p)}>
                          Sign in as
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => void toggleBan(p)}>
                        {p.banned ? 'Restore' : 'Suspend'}
                      </Button>
                    </>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {activityOf && (
        <section aria-label="Activity" className="space-y-1 text-sm">
          <h2 className="font-semibold">Activity of {activityOf.email}</h2>
          {activity?.length === 0 && <p className="text-muted-foreground">Nothing recorded.</p>}
          <ul className="divide-y divide-border rounded-lg border border-border">
            {activity?.map((e) => (
              <li key={`${e.at}-${e.type}`} className="px-3 py-2">
                {e.type.replaceAll('_', ' ')}
                {e.outcome === 'failure' ? ' (failed)' : ''}
                <span className="block text-xs text-muted-foreground">
                  {new Date(e.at).toLocaleString()}
                  {e.ipAddress ? ` · ${e.ipAddress}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </Button>
        <span>
          Page {page + 1} of {pages} ({total} people)
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </Button>
      </div>
      {role === 'admin' && <SsoAdminSection />}
      {role === 'admin' && <AiAppsAdminSection />}
    </div>
  )
}
