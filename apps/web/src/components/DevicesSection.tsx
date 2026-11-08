import { useCallback, useEffect, useState, type FormEvent, type JSX } from 'react'
import { DEVICE_NICKNAME_MAX, type Device } from '@repo/shared'
import { Button } from '@repo/ui'
import { api } from '../lib/api'

const when = (iso: string): string => new Date(iso).toLocaleString()

/** Where you are signed in: give each place a name, and sign out the ones you no longer use. */
export function DevicesSection(): JSX.Element {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  // Fetch the list. `cancelled` stops an answer that arrives after the page was closed from updating it.
  const fetchDevices = useCallback(
    (cancelled: () => boolean): Promise<void> =>
      api.devices
        .list()
        .then((list) => {
          if (cancelled()) return
          setDevices(list)
          setError(null)
        })
        .catch((e: unknown) => {
          console.error(e)
          if (!cancelled()) setError('Could not load your devices.')
        }),
    []
  )
  const load = useCallback(() => fetchDevices(() => false), [fetchDevices])

  useEffect(() => {
    let cancelled = false
    void fetchDevices(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [fetchDevices])

  async function save(event: FormEvent, device: Device): Promise<void> {
    event.preventDefault()
    try {
      await api.devices.rename(device.id, draft.trim() === '' ? null : draft)
      setEditing(null)
      await load()
    } catch (e) {
      console.error(e)
      setError('Could not save the name.')
    }
  }

  async function signOut(device: Device): Promise<void> {
    try {
      await api.devices.signOut(device.id)
      await load()
    } catch (e) {
      console.error(e)
      setError('Could not sign that device out.')
    }
  }

  return (
    <section className="space-y-2" aria-label="Your devices">
      <h2 className="text-lg font-semibold">Your devices</h2>
      <p className="text-sm text-muted-foreground">
        Everywhere you are signed in. Sign out the ones you do not recognise or no longer use.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {devices === null && !error && <p className="text-sm text-muted-foreground">Loading...</p>}
      <ul className="space-y-2">
        {devices?.map((device) => (
          <li key={device.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium">{device.nickname ?? device.label}</span>
                {device.nickname && (
                  <span className="ml-2 text-muted-foreground">{device.label}</span>
                )}
                {device.current && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">This device</span>
                )}
                <p className="text-xs text-muted-foreground">
                  Signed in {when(device.createdAt)} · last seen {when(device.lastSeenAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditing(device.id)
                    setDraft(device.nickname ?? '')
                  }}
                >
                  Rename
                </Button>
                {!device.current && (
                  <Button variant="outline" size="sm" onClick={() => void signOut(device)}>
                    Sign out
                  </Button>
                )}
              </div>
            </div>
            {editing === device.id && (
              <form onSubmit={(e) => void save(e, device)} className="mt-2 flex gap-2">
                <input
                  autoFocus
                  aria-label="Device name"
                  value={draft}
                  maxLength={DEVICE_NICKNAME_MAX}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Work laptop"
                  className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                  Cancel
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
