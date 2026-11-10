import { useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Navigate, useSearchParams } from 'react-router'
import { authClient } from '../lib/auth'

type Request = { status: string; client_id?: string; scope?: string }
type Phase = 'enter' | 'review' | 'done' | 'denied' | 'failed'

const SCOPE_TEXT: Record<string, string> = {
  openid: 'Know who you are',
  profile: 'See your name',
  email: 'See your email address',
  offline_access: 'Stay connected until you remove it',
  'mcp:read': 'Read your account: teams, devices and recent security activity',
  'mcp:write': 'Sign your devices out of your account'
}

/**
 * Where a person types the short code an AI app without a browser (a terminal agent) shows them. The page names the
 * app and what it asks for before anything is approved: a code someone else gave you is how this flow is abused.
 */
export function DevicePage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  const [params] = useSearchParams()
  const [code, setCode] = useState((params.get('user_code') ?? '').toUpperCase())
  const [phase, setPhase] = useState<Phase>('enter')
  const [request, setRequest] = useState<Request | null>(null)
  const [name, setName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function look(userCode: string): Promise<void> {
    setError(null)
    const { data, error: failure } = await authClient.$fetch<Request>('/device', {
      query: { user_code: userCode.replaceAll('-', '').trim() }
    })
    if (failure || !data || data.status !== 'pending' || !data.client_id) {
      setError('That code does not work. It may have expired or been used already.')
      return
    }
    setRequest(data)
    setPhase('review')
    const { data: client } = await authClient.$fetch<{ client_name?: string }>(
      '/oauth2/public-client',
      { query: { client_id: data.client_id } }
    )
    setName(client?.client_name ?? null)
  }

  const initial = params.get('user_code')

  async function answer(accept: boolean): Promise<void> {
    const { error: failure } = await authClient.$fetch(
      accept ? '/device/approve' : '/device/deny',
      {
        method: 'POST',
        body: { userCode: code.replaceAll('-', '').trim() }
      }
    )
    if (failure) setPhase('failed')
    else setPhase(accept ? 'done' : 'denied')
  }

  if (isPending) return <p className="text-center text-muted-foreground">Loading...</p>
  if (!session)
    return (
      <Navigate
        to={`/sign-in?next=${encodeURIComponent(`/device${initial ? `?user_code=${encodeURIComponent(initial)}` : ''}`)}`}
        replace
      />
    )

  let host = request?.client_id ?? ''
  try {
    host = new URL(request?.client_id ?? '').host
  } catch {
    /* shown as given */
  }

  if (phase === 'done' || phase === 'denied')
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">
          {phase === 'done' ? 'App connected' : 'Request denied'}
        </h1>
        <p className="text-muted-foreground">You can close this page.</p>
      </div>
    )

  if (phase === 'review' && request)
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="text-3xl font-bold tracking-tight">Connect {name ?? host}?</h1>
        <p className="text-muted-foreground">
          <strong>{name ?? host}</strong> (from <strong>{host}</strong>) wants to act for you. It
          will be able to:
        </p>
        <ul className="list-disc space-y-1 pl-6 text-sm">
          {(request.scope ?? '')
            .split(' ')
            .filter(Boolean)
            .map((scope) => (
              <li key={scope}>{SCOPE_TEXT[scope] ?? scope}</li>
            ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Only continue if you just started this yourself, and the code on your screen is{' '}
          <strong>{code}</strong>. If someone else sent you here, choose Deny.
        </p>
        {phase === 'review' && error && <p role="alert">{error}</p>}
        <div className="flex gap-2">
          <Button onClick={() => void answer(true)}>Allow</Button>
          <Button variant="outline" onClick={() => void answer(false)}>
            Deny
          </Button>
        </div>
      </div>
    )

  function submit(event: FormEvent): void {
    event.preventDefault()
    if (code.trim()) void look(code)
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">Enter the code</h1>
      <p className="text-muted-foreground">Type the code the app is showing you.</p>
      <label className="block text-sm">
        Code
        <input
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono tracking-widest"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      {(error || phase === 'failed') && (
        <p role="alert" className="text-sm text-red-600">
          {error ?? 'Something went wrong. Start again from the app.'}
        </p>
      )}
      <Button type="submit">Continue</Button>
    </form>
  )
}
