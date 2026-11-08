import { useEffect, useRef, type JSX } from 'react'

interface TurnstileApi {
  render: (
    el: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    }
  ) => string
  reset: (widgetId?: string) => void
  remove: (widgetId?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise: Promise<TurnstileApi> | null = null

/** Loads Cloudflare's script once. Explicit rendering, because this is a single-page app. */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing'))
    script.onerror = () => {
      scriptPromise = null
      reject(new Error('turnstile failed to load'))
    }
    document.head.appendChild(script)
  })
  return scriptPromise
}

interface Props {
  siteKey: string
  /** Called with a fresh token, or with null when it expired or the challenge failed. */
  onToken: (token: string | null) => void
  /** Change this number to ask for a new challenge (a token works once). */
  resetKey: number
}

/** The Cloudflare Turnstile challenge. Tokens are single use and expire after five minutes. */
export function Turnstile({ siteKey, onToken, resetKey }: Props): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const widget = useRef<string | null>(null)
  const callback = useRef(onToken)
  useEffect(() => {
    callback.current = onToken
  }, [onToken])

  useEffect(() => {
    let cancelled = false
    void loadTurnstile()
      .then((api) => {
        if (cancelled || !host.current) return
        widget.current = api.render(host.current, {
          sitekey: siteKey,
          callback: (token) => callback.current(token),
          'expired-callback': () => callback.current(null),
          'error-callback': () => callback.current(null)
        })
      })
      .catch(() => callback.current(null))
    return () => {
      cancelled = true
      if (widget.current) window.turnstile?.remove(widget.current)
      widget.current = null
    }
  }, [siteKey])

  useEffect(() => {
    if (resetKey > 0 && widget.current) window.turnstile?.reset(widget.current)
  }, [resetKey])

  return <div ref={host} data-testid="turnstile" />
}
