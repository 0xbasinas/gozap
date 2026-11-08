import { useEffect, useState, type JSX } from 'react'
import { authClient } from '../lib/auth'

/**
 * The last stop of "Sign in" from the desktop app. The server has set a short-lived cookie with a one-time
 * code; this page waits for it and then opens the desktop app through its deep link.
 */
export function DesktopCallbackPage(): JSX.Element {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const poll = authClient.ensureElectronRedirect()
    const timer = setTimeout(() => setSlow(true), 10_000)
    return () => {
      clearInterval(poll)
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className="mx-auto max-w-sm space-y-3 text-center">
      <h1 className="text-2xl font-bold tracking-tight">Opening the desktop app</h1>
      <p className="text-muted-foreground">
        You are signed in. If your browser asks, allow it to open the app. You can close this tab
        afterwards.
      </p>
      {slow && (
        <p role="status" className="text-sm text-muted-foreground">
          Nothing happened? Make sure the desktop app is installed, then choose Sign in in the app
          again.
        </p>
      )}
    </div>
  )
}
