import { useState, type FormEvent, type JSX } from 'react'
import { FEEDBACK_MESSAGE_MAX, type FeedbackKind } from '@repo/shared'
import { Button, cn } from '@repo/ui'
import { Navigate } from 'react-router'
import { api } from '../lib/api'
import { authClient } from '../lib/auth'

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'idea', label: 'An idea' },
  { value: 'other', label: 'Something else' }
]

/** Send feedback to the people who run the app. Needs a session, so the answer can find you and spam cannot. */
export function FeedbackPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return <p className="text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return <FeedbackForm />
}

function FeedbackForm(): JSX.Element {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.feedback.send({
        kind,
        message,
        source: 'web',
        platform: navigator.platform.slice(0, 32)
      })
      setSent(true)
      setMessage('')
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Could not send your feedback.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Send feedback</h1>
      <p className="text-muted-foreground">
        Tell us what is broken or what you wish it did. We store your message with your account, and
        you can see or delete it in your data export.
      </p>
      {sent && (
        <p role="status" className="rounded-md border border-border p-3 text-sm">
          Thank you, we got it.{' '}
          <button type="button" className="underline" onClick={() => setSent(false)}>
            Send another
          </button>
        </p>
      )}
      {!sent && (
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div role="radiogroup" aria-label="Kind of feedback" className="flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k.value}
                type="button"
                role="radio"
                aria-checked={kind === k.value}
                onClick={() => setKind(k.value)}
                className={cn(
                  'rounded-md border px-3 py-1 text-sm',
                  kind === k.value ? 'border-primary bg-accent' : 'text-muted-foreground'
                )}
              >
                {k.label}
              </button>
            ))}
          </div>
          <label className="block space-y-1 text-sm">
            <span className="font-medium">Your message</span>
            <textarea
              aria-label="Your message"
              required
              minLength={3}
              maxLength={FEEDBACK_MESSAGE_MAX}
              rows={6}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full rounded-md border border-input bg-background p-2"
            />
            <span className="block text-xs text-muted-foreground">
              {message.length} / {FEEDBACK_MESSAGE_MAX}
            </span>
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || message.trim().length < 3}>
            {busy ? 'Sending...' : 'Send feedback'}
          </Button>
        </form>
      )}
    </div>
  )
}
