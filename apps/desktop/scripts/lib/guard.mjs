// Rollout guard: decide from crash data whether a release should stop being offered.
// Pure functions only, so the decision is unit tested; scripts/rollout-guard.mjs does the network work.

export const DEFAULT_THRESHOLDS = {
  /** Below this many sessions there is not enough data to judge. */
  minSessions: 20,
  /** Pause when fewer than this share of sessions are crash free (0.98 = 2% crash). */
  minCrashFreeRate: 0.98,
  /** Pause when the crash-free rate is this much worse than the previous release (0.02 = 2 points). */
  maxDropFromPrevious: 0.02
}

/**
 * Read the totals out of a Sentry "sessions" API response for one release.
 * Returns null when Sentry has no sessions for it yet.
 */
export function parseSessions(response) {
  const totals = response?.groups?.[0]?.totals
  if (!totals) return null
  const sessions = Number(totals['sum(session)'] ?? 0)
  const rate = totals['crash_free_rate(session)']
  if (!sessions || rate === null || rate === undefined) return null
  return { sessions, crashFreeRate: Number(rate) }
}

/**
 * @param {{sessions:number, crashFreeRate:number} | null} current   the release being rolled out
 * @param {{sessions:number, crashFreeRate:number} | null} previous  the release before it, if known
 * @returns {{pause: boolean, verdict: 'pause' | 'healthy' | 'unknown', reason: string}}
 */
export function decide(current, previous, thresholds = DEFAULT_THRESHOLDS) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const percent = (rate) => `${(rate * 100).toFixed(2)}%`

  if (!current || current.sessions < t.minSessions) {
    const seen = current?.sessions ?? 0
    return {
      pause: false,
      verdict: 'unknown',
      reason: `Only ${seen} sessions so far (need ${t.minSessions}); not judging yet.`
    }
  }

  if (current.crashFreeRate < t.minCrashFreeRate) {
    return {
      pause: true,
      verdict: 'pause',
      reason: `Crash-free sessions are ${percent(current.crashFreeRate)}, below the ${percent(t.minCrashFreeRate)} limit (${current.sessions} sessions).`
    }
  }

  if (previous && previous.sessions >= t.minSessions) {
    const drop = previous.crashFreeRate - current.crashFreeRate
    if (drop > t.maxDropFromPrevious) {
      return {
        pause: true,
        verdict: 'pause',
        reason: `Crash-free sessions fell from ${percent(previous.crashFreeRate)} to ${percent(current.crashFreeRate)}, more than the allowed ${percent(t.maxDropFromPrevious)} drop.`
      }
    }
  }

  return {
    pause: false,
    verdict: 'healthy',
    reason: `Healthy: ${percent(current.crashFreeRate)} crash-free over ${current.sessions} sessions.`
  }
}
