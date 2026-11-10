import { useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { authClient } from '../lib/auth'

interface Consent {
  id: string
  clientId: string
  scopes: string[]
  createdAt: string
}

/** The AI apps this person approved, with a way to remove each one (which also ends its refresh tokens). */
export function ConnectedAppsSection(): JSX.Element | null {
  const [rows, setRows] = useState<Consent[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void authClient
      .$fetch<Consent[]>('/oauth2/get-consents')
      .then(async ({ data, error: failure }) => {
        if (cancelled) return
        if (failure) {
          setRows([])
          return
        }
        const list = Array.isArray(data) ? data : []
        setRows(list)
        const found: Record<string, string> = {}
        await Promise.all(
          list.map(async (c) => {
            const { data: client } = await authClient.$fetch<{ client_name?: string }>(
              '/oauth2/public-client',
              { query: { client_id: c.clientId } }
            )
            if (client?.client_name) found[c.clientId] = client.client_name
          })
        )
        if (!cancelled) setNames(found)
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  async function remove(id: string): Promise<void> {
    setError(null)
    const { error: failure } = await authClient.$fetch('/oauth2/delete-consent', {
      method: 'POST',
      body: { id }
    })
    if (failure) setError('Could not remove the app.')
    else setReload((n) => n + 1)
  }

  if (!rows || rows.length === 0) return null
  return (
    <section className="space-y-2" aria-label="Connected apps">
      <h2 className="text-lg font-semibold">Connected apps</h2>
      <p className="text-sm text-muted-foreground">
        AI apps you allowed to read your account. Removing one stops it from signing in again.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {names[row.clientId] ?? row.clientId}
              <span className="text-muted-foreground">
                {' '}
                since {new Date(row.createdAt).toLocaleDateString()}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void remove(row.id)}>
              Remove
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
