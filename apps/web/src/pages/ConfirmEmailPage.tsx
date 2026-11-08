import { useState, type JSX } from 'react'
import { Button } from '@repo/ui'
import { Link, useSearchParams } from 'react-router'
import { api } from '../lib/api'

type Status = 'ready' | 'working' | 'done' | 'failed'

/**
 * Where the link in the "confirm your new email address" message lands. The page only shows a button: the change
 * happens on the click (a POST), so an email scanner that opens links cannot confirm by accident.
 */
export function ConfirmEmailPage(): JSX.Element {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>('ready')
  const [email, setEmail] = useState('')

  async function confirm(): Promise<void> {
    if (!token) return
    setStatus('working')
    try {
      setEmail((await api.account.confirmEmailChange(token)).email)
      setStatus('done')
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
          It may have expired (links last an hour), been used already, or the address may belong to
          another account. Start again from the{' '}
          <Link className="underline" to="/account">
            account page
          </Link>
          .
        </p>
      </div>
    )
  }

  if (status === 'done') {
    return (
      <div className="mx-auto max-w-xl space-y-3">
        <h1 className="text-3xl font-bold tracking-tight">Your email address was changed</h1>
        <p className="text-muted-foreground">
          You now sign in with <strong>{email}</strong>.
        </p>
        <Link className="underline" to="/account">
          Back to your account
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-xl space-y-3">
      <h1 className="text-3xl font-bold tracking-tight">Use this email address?</h1>
      <p className="text-muted-foreground">
        Choose this to move your account to the address this link was sent to.
      </p>
      <Button disabled={status === 'working'} onClick={() => void confirm()}>
        Confirm this address
      </Button>
    </div>
  )
}
