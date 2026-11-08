import { useEffect, useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import {
  CONSENT_LABELS,
  CONSENT_PURPOSES,
  DATA_REQUEST_DEADLINE_DAYS,
  type Consents,
  type DataRequest,
  type PrivacySummary
} from '@repo/shared'
import { Link, Navigate } from 'react-router'
import { api } from '../lib/api'
import { authClient } from '../lib/auth'

const STATUS_LABEL: Record<DataRequest['status'], string> = {
  received: 'Received',
  processing: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled'
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** What we hold about you, in one place, with the export and delete controls next to it. */
export function PrivacyPage(): JSX.Element {
  const { data: session, isPending } = authClient.useSession()
  if (isPending) return <p className="text-muted-foreground">Loading...</p>
  if (!session) return <Navigate to="/sign-in" replace />
  return <PrivacyDetails email={session.user.email} />
}

function PrivacyDetails({ email }: { email: string }): JSX.Element {
  const [summary, setSummary] = useState<PrivacySummary | null>(null)
  const [requests, setRequests] = useState<DataRequest[]>([])
  const [consents, setConsents] = useState<Consents | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.account
      .privacy()
      .then((s) => {
        if (!cancelled) setSummary(s)
      })
      .catch((e: unknown) => {
        console.error(e)
        if (!cancelled) setError('Could not load your privacy summary.')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.account
      .requests()
      .then((list) => {
        if (!cancelled) setRequests(list)
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api.account
      .consents()
      .then((c) => {
        if (!cancelled) setConsents(c)
      })
      .catch((e: unknown) => console.error(e))
    return () => {
      cancelled = true
    }
  }, [])

  async function choose(
    purpose: (typeof CONSENT_PURPOSES)[number],
    granted: boolean
  ): Promise<void> {
    try {
      setConsents(await api.account.setConsent(purpose, granted))
    } catch (e) {
      console.error(e)
      setError('Could not save your choice.')
    }
  }

  async function download(): Promise<void> {
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
    } catch (e) {
      console.error(e)
      setError('Could not download your data.')
    }
  }

  const rows: { title: string; detail: string }[] = summary
    ? [
        { title: 'Account', detail: `Your email address (${email}) and when you joined.` },
        {
          title: 'Devices',
          detail: `${plural(summary.devices, 'place', 'places')} you are signed in, with any names you gave them.`
        },
        {
          title: 'Sign-in activity',
          detail: `${plural(summary.signIns, 'sign-in', 'sign-ins')} from the last 90 days (time, browser, IP address).`
        },
        {
          title: 'Passkeys',
          detail: `${plural(summary.passkeys, 'passkey', 'passkeys')} (public keys only).`
        },
        {
          title: 'Feedback',
          detail: `${plural(summary.feedback, 'message', 'messages')} you sent us, with any logs you attached.`
        },
        {
          title: 'Synced settings',
          detail: summary.hasSyncedSettings
            ? 'Your theme and accent colour, saved so they follow you between devices.'
            : 'None saved.'
        }
      ]
    : []

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">What we store about you</h1>
        <p className="text-sm text-muted-foreground">
          Everything below goes with your account when it is deleted.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!summary && !error && <p className="text-muted-foreground">Loading...</p>}
      <ul className="divide-y divide-border rounded-lg border border-border">
        {rows.map((row) => (
          <li key={row.title} className="px-4 py-3">
            <p className="font-medium">{row.title}</p>
            <p className="text-sm text-muted-foreground">{row.detail}</p>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void download()}>
          Download my data
        </Button>
        <Link
          to="/account"
          className="inline-flex h-9 items-center rounded-md border border-input px-4 text-sm font-medium hover:bg-accent"
        >
          Manage or delete my account
        </Link>
      </div>
      {consents && (
        <section className="space-y-2" aria-label="Your agreements">
          <h2 className="text-lg font-semibold">Your agreements</h2>
          <p className="text-sm text-muted-foreground">
            Each choice is saved with the date. You can change your mind at any time.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {CONSENT_PURPOSES.map((purpose) => {
              const on = consents.current[purpose] === true
              const last = consents.history.find((e) => e.purpose === purpose)
              return (
                <li key={purpose} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="text-sm">
                    <p className="font-medium">{CONSENT_LABELS[purpose].title}</p>
                    <p className="text-muted-foreground">{CONSENT_LABELS[purpose].description}</p>
                    {last && (
                      <p className="text-xs text-muted-foreground">
                        {last.granted ? 'Agreed' : 'Withdrawn'}{' '}
                        {new Date(last.at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <Button
                    variant={on ? 'outline' : 'default'}
                    size="sm"
                    onClick={() => void choose(purpose, !on)}
                  >
                    {on ? 'Withdraw' : 'Agree'}
                  </Button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
      {requests.length > 0 && (
        <section className="space-y-2" aria-label="Your requests">
          <h2 className="text-lg font-semibold">Your requests</h2>
          <p className="text-sm text-muted-foreground">
            We answer requests about your data within {DATA_REQUEST_DEADLINE_DAYS} days.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {requests.map((r) => (
              <li key={`${r.kind}-${r.receivedAt}`} className="px-4 py-2 text-sm">
                <span className="font-medium">
                  {r.kind === 'export' ? 'Data export' : 'Account deletion'}
                </span>
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">
                  {STATUS_LABEL[r.status]}
                </span>
                <p className="text-xs text-muted-foreground">
                  Asked {new Date(r.receivedAt).toLocaleDateString()}
                  {r.completedAt
                    ? ` · finished ${new Date(r.completedAt).toLocaleDateString()}`
                    : ` · due by ${new Date(r.dueAt).toLocaleDateString()}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-sm text-muted-foreground">
        Who else handles data for us is on the{' '}
        <Link className="underline" to="/sub-processors">
          sub-processors page
        </Link>
        .
      </p>
    </div>
  )
}
