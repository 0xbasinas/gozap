import { useCallback, useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { aiAppsSchema, type AiApp } from '@repo/shared'

/** Staff (admin role): the AI apps that have asked for access, with a switch to turn one off or on again. */
export function AiAppsAdminSection(): JSX.Element {
  const [apps, setApps] = useState<AiApp[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/ai-apps', { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        return aiAppsSchema.parse(await response.json())
      })
      .then((list) => {
        if (!cancelled) setApps(list)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setMessage('Could not load the AI apps.')
      })
    return () => {
      cancelled = true
    }
  }, [reload])

  const change = useCallback(async (app: AiApp, action: 'disable' | 'enable') => {
    if (
      action === 'disable' &&
      !window.confirm(
        `Switch off ${app.name ?? app.clientId}? It stops working at once and the ${app.people} approval(s) are removed; people have to approve it again if you switch it back on.`
      )
    )
      return
    const response = await fetch(`/api/admin/ai-apps/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clientId: app.clientId })
    })
    setMessage(response.ok ? null : 'That did not work.')
    setReload((n) => n + 1)
  }, [])

  return (
    <section aria-label="AI apps" className="space-y-2 pt-4">
      <h2 className="text-lg font-semibold">AI apps</h2>
      <p className="text-sm text-muted-foreground">
        Apps that asked to read an account. Switching one off cuts it off at once.
      </p>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {apps?.length === 0 && <p className="text-sm text-muted-foreground">None yet.</p>}
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {apps?.map((app) => (
          <li key={app.clientId} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0">
              <span className="block truncate font-medium">{app.name ?? 'Unnamed app'}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {app.clientId} · {app.people} {app.people === 1 ? 'person' : 'people'}
                {app.disabled ? ' · switched off' : ''}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void change(app, app.disabled ? 'enable' : 'disable')}
            >
              {app.disabled ? 'Switch on' : 'Switch off'}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
