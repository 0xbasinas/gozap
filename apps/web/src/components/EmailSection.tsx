import { useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { api } from '../lib/api'

/** Move the account to a new email address. A link goes to the new address; nothing changes until it is used. */
export function EmailSection({
  email,
  pendingEmail
}: {
  email: string
  pendingEmail: string | null
}): JSX.Element {
  const [newEmail, setNewEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(pendingEmail)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.account.changeEmail(newEmail)
      setSentTo(newEmail.trim().toLowerCase())
      setNewEmail('')
    } catch (e) {
      console.error(e)
      setError(
        'Could not start the change. Check the address, and wait a minute if you just asked.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Email address</h2>
      <p className="text-sm text-muted-foreground">
        You sign in with <strong>{email}</strong>. To change it, enter the new address. We send it a
        link, and the change happens when you open it.
      </p>
      {sentTo && (
        <p role="status" className="text-sm">
          Check {sentTo} for a confirmation link. It works for an hour.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form onSubmit={(e) => void submit(e)} className="flex gap-2">
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="new@example.com"
          aria-label="New email address"
          autoComplete="off"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline" disabled={busy || newEmail.trim() === ''}>
          Change email
        </Button>
      </form>
    </section>
  )
}
