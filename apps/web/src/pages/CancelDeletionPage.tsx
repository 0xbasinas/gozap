import { useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Link, useSearchParams } from 'react-router'
import { api } from '../lib/api'

type Status = 'ready' | 'working' | 'kept' | 'failed'

/**
 * Where the link in the "your account will be deleted" email lands. The page only shows a button: the cancel happens
 * on the click (a POST), so an email scanner that opens links cannot cancel by accident.
 */
export function CancelDeletionPage(): JSX.Element {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>('ready')

  async function keep(): Promise<void> {
    if (!token) return
    setStatus('working')
    try {
      await api.account.cancelDeletionWithToken(token)
      setStatus('kept')
    } catch (e) {
      console.error(e)
      setStatus('failed')
    }
  }

  if (!token || status === 'failed') {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">This link does not work</h1>
        <p className="text-muted-foreground">
          It may have expired, been used already, or the account may already be deleted. If you are
          still signed in, you can keep your account from the{' '}
          <Link className="underline" to="/account">
            account page
          </Link>
          .
        </p>
      </div>
    )
  }

  if (status === 'kept') {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Your account is safe</h1>
        <p className="text-muted-foreground">The deletion was cancelled. Nothing was removed.</p>
        <Link className="underline" to="/sign-in">
          Sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">Keep your account?</h1>
      <p className="text-muted-foreground">
        Your account is set to be deleted. Choose this to cancel the deletion and keep everything.
      </p>
      <Button disabled={status === 'working'} onClick={() => void keep()}>
        Keep my account
      </Button>
    </div>
  )
}
