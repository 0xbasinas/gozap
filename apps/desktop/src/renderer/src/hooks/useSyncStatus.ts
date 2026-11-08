import { useEffect, useState } from 'react'
import type { SyncStatus } from '../../../shared/syncStatus'

/** How the account sync is doing, plus the current time (refreshed each half minute so "5 minutes ago" stays true). */
export function useSyncStatus(): { status: SyncStatus | undefined; now: number } {
  const [status, setStatus] = useState<SyncStatus>()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    void window.api.getSyncStatus().then(setStatus)
    const off = window.api.onSyncStatusChanged((next) => {
      setStatus(next)
      setNow(Date.now())
    })
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => {
      off()
      window.clearInterval(timer)
    }
  }, [])

  return { status, now }
}
