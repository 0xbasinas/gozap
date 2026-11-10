import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'

interface Credential {
  id: string
  expiresAt: string
  revoked: boolean
  lastUsedAt: string | null
}
interface Connection {
  id: string
  name: string
  people: number
  blocked?: number
  credentials: Credential[]
}
interface Shown {
  token: string
  expiresAt: string
}

const day = (iso: string): string => new Date(iso).toLocaleDateString()

interface GroupRow {
  id: string
  name: string
  grantsAdmin: boolean
}

/** The groups the directory pushed. Ticking one makes everyone in it a team admin (never an owner). */
function GroupRoles({ connectionId }: { connectionId: string }): JSX.Element | null {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [reload, setReload] = useState(0)
  useEffect(() => {
    let cancelled = false
    void fetch(`/api/scim-connections/${connectionId}/groups`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? (r.json() as Promise<{ groups: GroupRow[] }>) : { groups: [] }))
      .then((body) => {
        if (!cancelled) setGroups(body.groups)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [connectionId, reload])
  if (groups.length === 0) return null
  async function toggle(group: GroupRow): Promise<void> {
    if (
      !group.grantsAdmin &&
      !window.confirm(
        `Make everyone in "${group.name}" a team admin? Whoever manages that group in your directory will then decide who can change this team's sign-in settings.`
      )
    )
      return
    await fetch(`/api/scim-connections/${connectionId}/groups/${group.id}`, {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grantsAdmin: !group.grantsAdmin })
    })
    setReload((n) => n + 1)
  }
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">
        Groups from the directory. A ticked group makes its people team admins.
      </p>
      <ul className="space-y-1">
        {groups.map((g) => (
          <li key={g.id}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={g.grantsAdmin} onChange={() => void toggle(g)} />
              {g.name}
            </label>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Team owners: connect the company directory (Okta, Entra ...) so staff are added and removed automatically. */
export function DirectorySyncSection({ organizationId }: { organizationId: string }): JSX.Element {
  const [baseUrl, setBaseUrl] = useState('')
  const [connections, setConnections] = useState<Connection[]>([])
  const [name, setName] = useState('')
  const [shown, setShown] = useState<Shown | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void fetch(`/api/scim-connections?organizationId=${encodeURIComponent(organizationId)}`, {
      credentials: 'same-origin'
    })
      .then(async (response) => {
        if (!response.ok) return
        const data = (await response.json()) as { baseUrl: string; connections: Connection[] }
        if (!cancelled) {
          setBaseUrl(data.baseUrl)
          setConnections(data.connections)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [organizationId, reload])

  const refresh = useCallback(() => setReload((n) => n + 1), [])

  async function call(path: string, method: string, body?: unknown): Promise<Response> {
    const response = await fetch(`/api/scim-connections${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null
      setMessage(error?.error ?? 'That did not work.')
    } else setMessage(null)
    return response
  }

  async function create(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!name.trim()) return
    const response = await call('', 'POST', { organizationId, name: name.trim() })
    if (response.ok) {
      setShown((await response.json()) as Shown)
      setName('')
      refresh()
    }
  }

  async function rotate(id: string): Promise<void> {
    const response = await call(`/${id}/credentials`, 'POST', {})
    if (response.ok) {
      setShown((await response.json()) as Shown)
      refresh()
    }
  }

  async function revoke(id: string, credentialId: string): Promise<void> {
    await call(`/${id}/credentials/${credentialId}`, 'DELETE')
    refresh()
  }

  async function allowAgain(id: string): Promise<void> {
    if (
      !window.confirm(
        'Let the directory create these accounts again? They were deleted by the people themselves.'
      )
    )
      return
    await call(`/${id}/tombstones`, 'DELETE')
    refresh()
  }

  async function remove(id: string): Promise<void> {
    if (
      !window.confirm(
        'Remove this directory connection? The directory stops working and its records are deleted. Accounts and team members stay.'
      )
    )
      return
    await call(`/${id}`, 'DELETE')
    refresh()
  }

  return (
    <section className="space-y-3" aria-label="Directory sync">
      <h2 className="text-lg font-semibold">Directory sync (SCIM)</h2>
      <p className="text-sm text-muted-foreground">
        Connect your company directory (Okta, Microsoft Entra and others). People you assign there
        are added to this team, and removed when you switch them off. Set the directory&apos;s SCIM
        base URL to <code className="break-all">{baseUrl}</code> with a token from here, and send
        each person&apos;s sign-in subject as <code>externalId</code>.
      </p>
      {shown && (
        <div role="status" className="space-y-1 rounded-md border border-border p-3 text-sm">
          <p>Copy this token now. It is shown once and expires on {day(shown.expiresAt)}.</p>
          <code className="block break-all">{shown.token}</code>
          <Button variant="outline" size="sm" onClick={() => setShown(null)}>
            I have copied it
          </Button>
        </div>
      )}
      {connections.map((conn) => (
        <div key={conn.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span>
              {conn.name} <span className="text-muted-foreground">({conn.people} people)</span>
            </span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void rotate(conn.id)}>
                New token
              </Button>
              <Button variant="outline" size="sm" onClick={() => void remove(conn.id)}>
                Remove
              </Button>
            </span>
          </div>
          {(conn.blocked ?? 0) > 0 && (
            <p className="flex items-center justify-between gap-2 text-muted-foreground">
              <span>
                {conn.blocked} deleted {conn.blocked === 1 ? 'account is' : 'accounts are'} not
                being recreated by the directory.
              </span>
              <Button variant="outline" size="sm" onClick={() => void allowAgain(conn.id)}>
                Allow again
              </Button>
            </p>
          )}
          <GroupRoles connectionId={conn.id} />
          <ul className="space-y-1">
            {conn.credentials
              .filter((k) => !k.revoked)
              .map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    Token expires {day(k.expiresAt)}
                    {k.lastUsedAt ? `, last used ${day(k.lastUsedAt)}` : ', never used'}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => void revoke(conn.id, k.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
          </ul>
        </div>
      ))}
      <form onSubmit={(e) => void create(e)} className="flex gap-2">
        <input
          aria-label="Directory name"
          placeholder="Name, such as Okta"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Connect a directory
        </Button>
      </form>
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
