import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdaterEvent } from '../../../shared/ipc'

export interface UpdaterState {
  /** What the banner should show, or undefined for nothing. */
  event: UpdaterEvent | undefined
  /** True while a check you started yourself is running. */
  checking: boolean
  check: () => void
  install: () => void
  dismiss: () => void
}

/** Subscribes to updater events from the main process and exposes simple actions. */
export function useUpdater(): UpdaterState {
  const [event, setEvent] = useState<UpdaterEvent>()
  const [checking, setChecking] = useState(false)
  const manual = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    void window.api.getUpdaterStatus().then((e) => {
      if (e && (e.type === 'available' || e.type === 'progress' || e.type === 'downloaded')) {
        setEvent(e)
      }
    })
    const off = window.api.onUpdaterEvent((e) => {
      // "Checking", "up to date" and errors only matter if you asked for the check.
      const quiet = e.type === 'checking' || e.type === 'not-available' || e.type === 'error'
      if (quiet && !manual.current) return
      if (e.type !== 'checking') {
        manual.current = false
        setChecking(false)
      }
      setEvent(e)
      clearTimeout(timer.current)
      if (e.type === 'not-available' || e.type === 'error') {
        timer.current = setTimeout(() => setEvent(undefined), 4000)
      }
    })
    return () => {
      off()
      clearTimeout(timer.current)
    }
  }, [])

  const check = useCallback(() => {
    manual.current = true
    setChecking(true)
    void window.api.checkForUpdates().finally(() => {
      // In dev there is nothing to check, so do not spin forever.
      setTimeout(() => setChecking(false), 300)
    })
  }, [])

  return {
    event,
    checking,
    check,
    install: () => void window.api.installUpdate(),
    dismiss: () => setEvent(undefined)
  }
}
