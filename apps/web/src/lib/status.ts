/**
 * Where a stable release should be in its staged rollout, by age: 10% when published, 25% after one day, 50% after
 * two, 100% after three (the schedule in docs/releasing/rollouts.md). It is the usual schedule, not a measurement: the
 * guard pauses a release that looks unhealthy, and the people who run the app can change it by hand.
 */
export function expectedRollout(publishedAt: string, now = Date.now()): number | null {
  const published = Date.parse(publishedAt)
  if (Number.isNaN(published)) return null
  const days = (now - published) / 86_400_000
  if (days < 1) return 10
  if (days < 2) return 25
  if (days < 3) return 50
  return 100
}

/** "just now", "5 hours ago", "3 days ago". */
export function ageText(publishedAt: string, now = Date.now()): string {
  const published = Date.parse(publishedAt)
  if (Number.isNaN(published)) return ''
  const hours = Math.floor((now - published) / 3_600_000)
  if (hours < 1) return 'just now'
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} days ago`
}
