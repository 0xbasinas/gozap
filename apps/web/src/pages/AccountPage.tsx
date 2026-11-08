import { useEffect, useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { ACCENTS, type Account, type Preferences } from '@repo/shared'
import { Navigate, useNavigate } from 'react-router'
import { api } from '../lib/api'
import { authClient } from '../lib/auth'
import { AccentPicker } from '@repo/ui'
import { currentAccent, currentTheme, setAccent, setTheme, syncTheme } from '../lib/theme'

type ThemeChoice = 'system' | 'light' | 'dark'

interface PasskeyRow {
  id: string
  name: string
}

/** Your account: see who you are, sign out everywhere, download your data, delete the account. */
export function AccountPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return <p className="text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return <AccountDetails />
}

function AccountDetails(): JSX.Element {
  const navigate = useNavigate()
  const [account, setAccount] = useState<Account | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmEmail, setConfirmEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [theme, setThemeState] = useState(currentTheme())
  const [accent, setAccentState] = useState(currentAccent())
  const [passkeys, setPasskeys] = useState<PasskeyRow[]>([])

  useEffect(() => {
    let cancelled = false
    api.account
      .get()
      .then((a) => {
        if (!cancelled) setAccount(a)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setError('Could not load your account.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    syncTheme()
      .then((p) => {
        if (cancelled) return
        setThemeState(p.theme)
        setAccentState(p.accent)
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      cancelled = true
    }
  }, [])

  async function chooseTheme(next: ThemeChoice): Promise<void> {
    setThemeState(next)
    const saved = await setTheme(next, true)
    setMessage(saved ? 'Saved. The desktop app will use it too.' : 'Saved on this device.')
  }

  async function chooseAccent(next: Preferences['accent']): Promise<void> {
    setAccentState(next)
    const saved = await setAccent(next, true)
    setMessage(saved ? 'Saved. The desktop app will use it too.' : 'Saved on this device.')
  }

  async function loadPasskeys(): Promise<void> {
    const { data } = await authClient.passkey.listUserPasskeys()
    setPasskeys((data ?? []).map((p) => ({ id: p.id, name: p.name ?? 'Passkey' })))
  }

  useEffect(() => {
    let cancelled = false
    authClient.passkey
      .listUserPasskeys()
      .then(({ data }) => {
        if (!cancelled)
          setPasskeys((data ?? []).map((p) => ({ id: p.id, name: p.name ?? 'Passkey' })))
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      cancelled = true
    }
  }, [])

  async function addPasskey(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const { error: failure } = await authClient.passkey.addPasskey({
        name: `Passkey ${passkeys.length + 1}`
      })
      if (failure && failure.status !== 0) throw new Error(failure.message)
      await loadPasskeys()
    } catch (e) {
      console.error(e)
      setError('Could not add the passkey.')
    } finally {
      setBusy(false)
    }
  }

  async function removePasskey(id: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await authClient.passkey.deletePasskey({ id })
      await loadPasskeys()
    } catch (e) {
      console.error(e)
      setError('Could not remove the passkey.')
    } finally {
      setBusy(false)
    }
  }

  async function signOutEverywhere(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await authClient.revokeSessions()
      await navigate('/sign-in')
    } catch (e) {
      console.error(e)
      setError('Could not sign you out everywhere.')
    } finally {
      setBusy(false)
    }
  }

  async function download(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const data = await api.account.export()
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      )
      const link = document.createElement('a')
      link.href = url
      link.download = 'my-data.json'
      link.click()
      URL.revokeObjectURL(url)
      setMessage('Your data was downloaded.')
    } catch (e) {
      console.error(e)
      setError('Could not download your data.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.account.remove(confirmEmail)
      await navigate('/')
      window.location.reload()
    } catch (e) {
      console.error(e)
      setError('Could not delete the account. Check that the email is typed exactly.')
      setBusy(false)
    }
  }

  const matches = account !== null && confirmEmail.trim().toLowerCase() === account.email

  return (
    <div className="mx-auto max-w-xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-sm text-muted-foreground">
          {account ? `Signed in as ${account.email}` : 'Loading your details...'}
        </p>
      </div>

      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">
          The theme and accent colour follow you: change them here or in the desktop app and the
          other one catches up.
        </p>
        <select
          aria-label="Theme"
          value={theme}
          onChange={(e) => void chooseTheme(e.target.value as ThemeChoice)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="system">Match my system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
        <AccentPicker
          accents={ACCENTS}
          value={accent}
          label="Accent colour"
          itemLabelPrefix="Accent "
          className="pt-1"
          onChange={(next) => void chooseAccent(next)}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Passkeys</h2>
        <p className="text-sm text-muted-foreground">
          Sign in with your fingerprint, face or a security key instead of waiting for an email.
        </p>
        {passkeys.length > 0 && (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2">
                <span className="text-sm">{p.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  aria-label={`Remove ${p.name}`}
                  onClick={() => void removePasskey(p.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" disabled={busy} onClick={() => void addPasskey()}>
          Add a passkey
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Sessions</h2>
        <p className="text-sm text-muted-foreground">
          Signs you out of this browser and every other browser and desktop app where you are signed
          in.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void signOutEverywhere()}>
          Sign out everywhere
        </Button>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Your data</h2>
        <p className="text-sm text-muted-foreground">
          Download everything we hold about you (your account, your settings and your sign-ins) as
          one file.
        </p>
        <Button variant="outline" disabled={busy} onClick={() => void download()}>
          Download my data
        </Button>
      </section>

      <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
        <h2 className="text-lg font-semibold text-destructive">Delete account</h2>
        <p className="text-sm text-muted-foreground">
          Permanently deletes your account, your settings and your sign-ins. This cannot be undone.
          Type your email to confirm.
        </p>
        <form onSubmit={(e) => void remove(e)} className="flex gap-2">
          <input
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
            placeholder={account?.email ?? 'you@example.com'}
            aria-label="Confirm your email"
            autoComplete="off"
            className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          />
          <Button type="submit" variant="destructive" disabled={busy || !matches}>
            Delete my account
          </Button>
        </form>
      </section>
    </div>
  )
}
