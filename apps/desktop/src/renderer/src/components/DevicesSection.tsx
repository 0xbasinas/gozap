import { useCallback, useEffect, useState } from 'react'
import type { Device } from '@repo/shared'
import type { DevicesResult } from '../../../shared/ipc'
import { Button } from '@repo/ui'

// Same as DEVICE_NICKNAME_MAX in @repo/shared (not imported: that module pulls zod into the page's bundle).
const NICKNAME_MAX = 40

const when = (iso: string): string => new Date(iso).toLocaleString()

/** Where you are signed in. Main calls the API as the signed-in person; the page only sees the list. */
export function DevicesSection(): React.JSX.Element {
  const [devices, setDevices] = useState<Device[]>()
  const [error, setError] = useState<string>()
  const [editing, setEditing] = useState<string>()
  const [draft, setDraft] = useState('')

  const show = useCallback((answer: DevicesResult, isCancelled: () => boolean): void => {
    if (isCancelled()) return
    if (answer.ok) {
      setDevices(answer.devices)
      setError(undefined)
    } else {
      setError(answer.error)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.listDevices().then((answer) => show(answer, () => cancelled))
    return () => {
      cancelled = true
    }
  }, [show])

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>): Promise<void> => {
    const answer = await action()
    if (!answer.ok) setError(answer.error)
    else show(await window.api.listDevices(), () => false)
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Everywhere you are signed in. Sign out the ones you no longer use.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {devices === undefined && !error && (
        <p className="text-sm text-muted-foreground">Loading...</p>
      )}
      <ul className="space-y-2">
        {devices?.map((device) => (
          <li key={device.id} className="rounded-lg border p-3 text-sm">
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void run(() => window.api.signOutDevice(device.id))}
                  >
                    Sign out
                  </Button>
                )}
              </div>
            </div>
            {editing === device.id && (
              <form
                className="mt-2 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void run(() => window.api.renameDevice(device.id, draft)).then(() =>
                    setEditing(undefined)
                  )
                }}
              >
                <input
                  autoFocus
                  aria-label="Device name"
                  value={draft}
                  maxLength={NICKNAME_MAX}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Work laptop"
                  className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-sm"
                />
                <Button type="submit" size="sm">
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(undefined)}
                >
                  Cancel
                </Button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
