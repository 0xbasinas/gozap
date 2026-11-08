import { useState } from 'react'
import type { FeedbackKind } from '@repo/shared'
import { Button, cn } from '@repo/ui'

// Same as FEEDBACK_MESSAGE_MAX in @repo/shared (not imported: that module pulls zod into the page's bundle).
const MESSAGE_MAX = 4000

const KINDS: { value: FeedbackKind; label: string }[] = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'idea', label: 'An idea' },
  { value: 'other', label: 'Something else' }
]

/** Send feedback to the people who run the app. Sent by the main process as the signed-in person. */
export function FeedbackSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string }>()

  if (!signedIn) {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in from Settings &gt; Account to send feedback. It is stored with your account so you
        can see or delete it later.
      </p>
    )
  }

  async function send(): Promise<void> {
    setBusy(true)
    setResult(undefined)
    try {
      const answer = await window.api.sendFeedback({ kind, message, includeDiagnostics })
      if (answer.ok) {
        setMessage('')
        setResult({ ok: true, text: 'Thank you, we got it.' })
      } else {
        setResult({ ok: false, text: answer.error })
      }
    } catch {
      setResult({ ok: false, text: 'Could not send your feedback.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
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
      <textarea
        aria-label="Your message"
        rows={4}
        maxLength={MESSAGE_MAX}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        className="w-full rounded-md border border-input bg-background p-2 text-sm"
      />
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={includeDiagnostics}
          onChange={(event) => setIncludeDiagnostics(event.target.checked)}
        />
        <span>
          Attach the diagnostics report
          <span className="block text-xs text-muted-foreground">
            Versions, graphics info and the last log lines. No account details. You can read it
            first under About and troubleshooting.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={busy || message.trim().length < 3} onClick={() => void send()}>
          {busy ? 'Sending...' : 'Send feedback'}
        </Button>
        {result && (
          <span
            role="status"
            className={cn('text-sm', result.ok ? 'text-muted-foreground' : 'text-destructive')}
          >
            {result.text}
          </span>
        )}
      </div>
    </div>
  )
}
