// How the account sync is doing, and how to say so. Pure (no Electron), so it is unit tested.

export type SyncState = 'signed-out' | 'syncing' | 'synced' | 'offline'

export interface SyncStatus {
  state: SyncState
  /** When the last sync worked (ms since 1970), or null if none has yet in this session. */
  lastSyncedAt: number | null
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago". */
export function timeAgo(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 30) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 1) return 'less than a minute ago'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** The line shown in Settings. */
export function describeSync(status: SyncStatus, now: number): string {
  switch (status.state) {
    case 'signed-out':
      return 'Signed out. Your theme and accent stay on this device.'
    case 'syncing':
      return 'Syncing...'
    case 'synced':
      return status.lastSyncedAt === null
        ? 'Synced.'
        : `Synced ${timeAgo(status.lastSyncedAt, now)}.`
    case 'offline':
      return status.lastSyncedAt === null
        ? 'Offline. Changes are saved here and will sync when you are back online.'
        : `Offline. Last synced ${timeAgo(status.lastSyncedAt, now)}; changes are saved here and will sync later.`
  }
}
