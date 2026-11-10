import { useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { useLocation } from 'react-router'
import { authClient } from '../lib/auth'

type Status = 'ready' | 'working' | 'failed'

/** What each permission an AI app asks for means, in plain words. */
const SCOPE_TEXT: Record<string, string> = {
  openid: 'Know who you are',
  profile: 'See your name',
  email: 'See your email address',
  offline_access: 'Stay connected until you remove it',
  'mcp:read': 'Read your account: teams, devices and recent security activity',
  'mcp:write': 'Sign your devices out of your account'
}

/**
 * Where an AI app sends a signed-in person to approve it. The address carries the app's signed request; choosing a
 * button posts it back and the server answers with where to send the browser next.
 */
export function ConsentPage(): JSX.Element {
  const query = useLocation().search.slice(1)
  const params = new URLSearchParams(query)
  const clientId = params.get('client_id')
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean)
  // The name is whatever the app calls itself, so the address it is served from is shown as well.
  let host = clientId ?? ''
  try {
    host = new URL(clientId ?? '').host
  } catch {
    /* shown as given */
  }
  const [name, setName] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('ready')

  useEffect(() => {
    if (!clientId) return
    void authClient
      .$fetch<{ client_name?: string }>('/oauth2/public-client', { query: { client_id: clientId } })
      .then(({ data }) => setName(data?.client_name ?? null))
  }, [clientId])

  async function answer(accept: boolean): Promise<void> {
    setStatus('working')
    const { data, error } = await authClient.$fetch<{ url?: string }>('/oauth2/consent', {
      method: 'POST',
      body: { accept, oauth_query: query }
    })
    if (error || !data?.url) {
      setStatus('failed')
      return
    }
    window.location.assign(data.url)
  }

  if (!clientId || !query.includes('sig=')) {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">This link does not work</h1>
        <p className="text-muted-foreground">Start again from the app you wanted to connect.</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Connect {name ?? 'this app'}?</h1>
      <p className="text-muted-foreground">
        <strong>{name ?? host}</strong> (from <strong>{host}</strong>) wants to act for you. It will
        be able to:
      </p>
      <ul className="list-disc space-y-1 pl-6 text-sm">
        {scopes.map((scope) => (
          <li key={scope}>{SCOPE_TEXT[scope] ?? scope}</li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Only continue if you started this from an app you trust. You can remove it any time on your
        account page.
      </p>
      {status === 'failed' && (
        <p role="alert" className="text-sm text-red-600">
          Something went wrong. Start again from the app.
        </p>
      )}
      <div className="flex gap-2">
        <Button disabled={status === 'working'} onClick={() => void answer(true)}>
          Allow
        </Button>
        <Button
          variant="outline"
          disabled={status === 'working'}
          onClick={() => void answer(false)}
        >
          Deny
        </Button>
      </div>
    </div>
  )
}
