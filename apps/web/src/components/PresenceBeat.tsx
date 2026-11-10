import { useEffect, type JSX } from 'react'

const EVERY_MS = 120_000

/**
 * Sends "I am here" every couple of minutes while the page is open and visible, but only for someone who switched
 * "Show when I am online" on (see presence.ts). Renders nothing.
 */
export function PresenceBeat({ userId }: { userId: string }): JSX.Element | null {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    const ping = (): void => {
      if (document.visibilityState === 'visible')
        void fetch('/api/presence/ping', { method: 'POST', credentials: 'same-origin' }).catch(
          () => undefined
        )
    }
    void fetch('/api/presence/me', { credentials: 'same-origin' })
      .then(async (r) => (r.ok ? ((await r.json()) as { visible: boolean }).visible : false))
      .catch(() => false)
      .then((visible) => {
        if (cancelled || !visible) return
        ping()
        timer = setInterval(ping, EVERY_MS)
      })
    return () => {
      cancelled = true
      if (timer) clearInterval(timer)
    }
  }, [userId])
  return null
}
