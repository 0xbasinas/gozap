// Auto-promotion: how far a stable release should be rolled out, based only on how old it is.
// The first step (the percentage a release starts at) is set by `rollout` in publish-stable.yml;
// these are the later steps. Each one is held back by the rollout guard and by a manual pause.

/** After this many hours the release should be at least this percent. Keep it sorted. */
export const DEFAULT_SCHEDULE = [
  { afterHours: 24, percent: 25 },
  { afterHours: 48, percent: 50 },
  { afterHours: 72, percent: 100 }
]

/** The percentage the schedule asks for at this age (or null before the first step). */
export function scheduledPercent(ageHours, schedule = DEFAULT_SCHEDULE) {
  let target = null
  for (const step of schedule) {
    if (ageHours >= step.afterHours) target = step.percent
  }
  return target
}

/**
 * Decide the next rollout percentage.
 * @param {{ageHours: number, current: number, verdict: 'healthy' | 'pause' | 'paused' | 'unknown', allowWithoutData?: boolean}} input
 * @returns {{percent: number | null, reason: string}}  percent is null when nothing should change
 */
export function nextRollout({ ageHours, current, verdict, allowWithoutData = false }, schedule) {
  if (current <= 0)
    return { percent: null, reason: 'Rollout is paused (0%). Raise it by hand when ready.' }
  if (current >= 100) return { percent: null, reason: 'Already at 100%.' }

  if (verdict === 'pause' || verdict === 'paused') {
    return {
      percent: null,
      reason: 'The rollout guard found crashes, so the release is not promoted.'
    }
  }
  if (verdict !== 'healthy' && !allowWithoutData) {
    return {
      percent: null,
      reason:
        'No crash data to confirm the release is healthy. Promote by hand, or set AUTO_PROMOTE_WITHOUT_CRASH_DATA.'
    }
  }

  const target = scheduledPercent(ageHours, schedule)
  if (target === null) return { percent: null, reason: `Too early (${ageHours.toFixed(1)} h old).` }
  if (target <= current)
    return { percent: null, reason: `Already at ${current}% (schedule asks for ${target}%).` }
  return {
    percent: target,
    reason: `${ageHours.toFixed(1)} h old and healthy: ${current}% -> ${target}%.`
  }
}
