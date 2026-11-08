import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { authClient } from '../lib/auth'

interface KeyRow {
  id: string
  name: string | null
  start: string | null
  expiresAt: Date | string | null
}

const when = (value: Date | string | null): string =>
  value ? new Date(value).toLocaleDateString() : 'never'

/** Keys for scripts: send one in the `x-api-key` header. The full key is shown once, when it is made. */
export function ApiKeysSection(): JSX.Element {
  const [keys, setKeys] = useState<KeyRow[] | null>(null)
  const [name, setName] = useState('')
  const [fresh, setFresh] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void authClient.apiKey.list().then(({ data, error: failure }) => {
      if (cancelled) return
      if (failure) setError('Could not load your keys.')
      else setKeys((data?.apiKeys ?? []) as KeyRow[])
    })
    return () => {
      cancelled = true
    }
  }, [reload])

  const create = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault()
      if (!name.trim()) return
      setError(null)
      const { data, error: failure } = await authClient.apiKey.create({ name: name.trim() })
      if (failure || !data) {
        setError(failure?.message ?? 'Could not make the key.')
        return
      }
      setFresh(data.key)
      setName('')
      setReload((n) => n + 1)
    },
    [name]
  )

  async function remove(id: string): Promise<void> {
    const { error: failure } = await authClient.apiKey.delete({ keyId: id })
    if (failure) setError('Could not delete the key.')
    else setReload((n) => n + 1)
  }

  return (
    <section className="space-y-2" aria-label="API keys">
      <h2 className="text-lg font-semibold">API keys</h2>
      <p className="text-sm text-muted-foreground">
        For scripts that act as you. Send the key in the <code>x-api-key</code> header. Keys expire
        after 90 days; delete one you no longer need.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {fresh && (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Copy your new key now, it is not shown again: <code className="break-all">{fresh}</code>
        </p>
      )}
      <form onSubmit={(e) => void create(e)} className="flex gap-2">
        <input
          aria-label="Key name"
          placeholder="Name, like Backup script"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Make a key
        </Button>
      </form>
      {keys?.length === 0 && <p className="text-sm text-muted-foreground">No keys yet.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {keys?.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-3 p-3 text-sm">
            <span>
              {k.name} <span className="text-muted-foreground">({k.start}…)</span>
              <span className="block text-muted-foreground">Expires {when(k.expiresAt)}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void remove(k.id)}>
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
