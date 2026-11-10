import { useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Link, Navigate, useParams, useSearchParams } from 'react-router'
import { emailSchema } from '@repo/shared'
import { authClient } from '../lib/auth'

/**
 * /t/<slug>/sign-in: the page a company gives its people. One button, straight to the company's own login, with the
 * email link as a way out. A team that has no company sign-in (or none proven) looks like any other missing page.
 */
export function TeamSignInPage(): JSX.Element {
  const { slug = '' } = useParams()
  const [params] = useSearchParams()
  const { data: session } = authClient.useSession()
  const [name, setName] = useState<string | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const wanted = params.get('next') ?? ''
  // A path on this site only.
  const next = /^\/(?![/\\])/.test(wanted) ? wanted : '/app'
  // A link may carry the person's address (?login_hint=ada@acme.com) so the company's login can fill it in.
  const hint = emailSchema.safeParse(params.get('login_hint') ?? '')

  useEffect(() => {
    let cancelled = false
    fetch(`/api/team-sign-in/${encodeURIComponent(slug)}`, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return null
        const body = (await response.json()) as { name?: unknown }
        return typeof body.name === 'string' ? body.name : null
      })
      .catch(() => null)
      .then((found) => {
        if (!cancelled) setName(found)
      })
    return () => {
      cancelled = true
    }
  }, [slug])

  if (session) return <Navigate to={next} replace />
  if (name === undefined)
    return (
      <p role="status" className="text-center text-muted-foreground">
        Loading...
      </p>
    )
  if (name === null) return <Navigate to="/sign-in" replace />

  async function go(): Promise<void> {
    setError(null)
    const { error: failure } = await authClient.signIn.sso({
      organizationSlug: slug,
      callbackURL: next,
      ...(hint.success ? { loginHint: hint.data } : {})
    })
    if (failure)
      setError('Your company sign-in did not start. Try again, or use the email link instead.')
  }

  return (
    <div className="mx-auto max-w-sm space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Sign in to {name}</h1>
      <p className="text-sm text-muted-foreground">
        Use your {name} account. You will go to your company&apos;s login and come back here.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button className="w-full" onClick={() => void go()}>
        Continue with {name}
      </Button>
      <p className="text-center text-sm">
        <Link to="/sign-in" className="underline">
          Use an email link instead
        </Link>
      </p>
    </div>
  )
}
