import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { emailSchema } from '@repo/shared'
import { Navigate, useSearchParams } from 'react-router'
import { authClient } from '../lib/auth'
import { readDesktopParams } from '../lib/desktop'
import { api } from '../lib/api'
import { Turnstile } from '../components/Turnstile'

type State = 'idle' | 'sending' | 'sent'

const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && 'PublicKeyCredential' in window

export function SignInPage(): JSX.Element {
  const { data: session } = authClient.useSession()
  const [params] = useSearchParams()
  const desktop = readDesktopParams(params)
  // Where to go after signing in: a path on this site only (an invitation page, for example).
  const wanted = params.get('next') ?? ''
  const next = /^\/(?![/\\])/.test(wanted) ? wanted : '/app'
  const [email, setEmail] = useState('')
  const [state, setState] = useState<State>('idle')
  // Turnstile: the key comes from the API; with none, no challenge is asked for.
  const [siteKey, setSiteKey] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [challenge, setChallenge] = useState(0)
  useEffect(() => {
    void api
      .appConfig()
      .then((config) => setSiteKey(config.turnstileSiteKey ?? null))
      .catch(() => undefined)
  }, [])
  const [error, setError] = useState<string | null>(
    params.get('error') === 'suspended'
      ? 'This account has been suspended. Contact support if you think that is a mistake.'
      : params.get('error')
        ? 'That sign-in link did not work. It may have expired or been used already.'
        : null
  )

  // Already signed in on the web and the desktop app asked for a sign-in: hand the session over.
  const signedIn = Boolean(session)
  useEffect(() => {
    if (!signedIn || !desktop) return
    void authClient
      .$fetch('/electron/transfer-user', { method: 'POST', query: desktop, body: {} })
      .then(({ error: failure }) => {
        if (failure)
          setError('Could not hand the sign-in to the desktop app. Try again from the app.')
        else window.location.assign('/auth/desktop')
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per visit
  }, [signedIn])

  if (session && desktop) {
    return (
      <p className="text-center text-muted-foreground" role="status">
        Signing you in to the desktop app...
      </p>
    )
  }
  if (session) return <Navigate to={next} replace />

  async function signInWithPasskey(): Promise<void> {
    setError(null)
    const { error: failure } = await authClient.signIn.passkey()
    // Cancelling the browser prompt is not worth an error message.
    if (failure && failure.status !== 0)
      setError('That passkey did not work. Try the email link instead.')
  }

  async function signInWithCompany(): Promise<void> {
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setError('Enter your work email address first.')
      return
    }
    setError(null)
    const { error: failure } = await authClient.signIn.sso({
      email: parsed.data,
      callbackURL: desktop ? '/auth/desktop' : next
    })
    if (failure) setError('Your company has not set up single sign-on here. Use the email link.')
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    const parsed = emailSchema.safeParse(email)
    if (!parsed.success) {
      setError('Enter a valid email address.')
      return
    }
    if (siteKey && !token) {
      setError('Complete the check below first.')
      return
    }
    setError(null)
    setState('sending')
    const { error: failure } = await authClient.signIn.magicLink({
      email: parsed.data,
      // From the desktop app, the link ends on a page that opens the app; otherwise the web app.
      callbackURL: desktop ? '/auth/desktop' : next,
      errorCallbackURL: '/sign-in?error=link',
      ...(desktop || (siteKey && token)
        ? {
            fetchOptions: {
              ...(desktop ? { query: desktop } : {}),
              ...(siteKey && token ? { headers: { 'x-captcha-response': token } } : {})
            }
          }
        : {})
    })
    // A token works once: ask for a new one whatever the answer was.
    if (siteKey) {
      setToken(null)
      setChallenge((n) => n + 1)
    }
    if (failure) {
      setState('idle')
      setError(
        failure.status === 429
          ? 'Too many tries. Wait a minute and try again.'
          : 'Could not send the link. Try again.'
      )
      return
    }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <div className="mx-auto max-w-sm space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        <p className="text-muted-foreground">
          We sent a sign-in link to <strong>{email.trim()}</strong>. It works once and expires in 5
          minutes.
        </p>
        <Button variant="outline" onClick={() => setState('idle')}>
          Use a different email
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mx-auto max-w-sm space-y-4" noValidate>
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>
      <p className="text-sm text-muted-foreground">
        Enter your email and we will send you a link. No password, and new accounts are created
        automatically.
      </p>
      <label className="block space-y-1 text-sm">
        <span>Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
        />
      </label>
      {siteKey && <Turnstile siteKey={siteKey} onToken={setToken} resetKey={challenge} />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={state === 'sending'} className="w-full">
        {state === 'sending' ? 'Sending...' : 'Email me a sign-in link'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => void signInWithCompany()}
      >
        Sign in with your company
      </Button>
      {passkeysSupported() && (
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void signInWithPasskey()}
        >
          Sign in with a passkey
        </Button>
      )}
    </form>
  )
}
