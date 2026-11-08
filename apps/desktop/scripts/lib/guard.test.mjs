import { describe, expect, it } from 'vitest'
import { decide, parseSessions } from './guard.mjs'

const sentry = (sessions, rate) => ({
  groups: [{ by: {}, totals: { 'sum(session)': sessions, 'crash_free_rate(session)': rate } }]
})

describe('parseSessions', () => {
  it('reads totals from a Sentry response', () => {
    expect(parseSessions(sentry(120, 0.991))).toEqual({ sessions: 120, crashFreeRate: 0.991 })
  })

  it('returns null when there is no data yet', () => {
    expect(parseSessions({ groups: [] })).toBeNull()
    expect(parseSessions(sentry(0, null))).toBeNull()
    expect(parseSessions(undefined)).toBeNull()
  })
})

describe('decide', () => {
  const ok = { sessions: 200, crashFreeRate: 0.995 }

  it('does not judge on too little data', () => {
    expect(decide({ sessions: 5, crashFreeRate: 0 }, ok).pause).toBe(false)
    expect(decide(null, ok).pause).toBe(false)
  })

  it('pauses when too many sessions crash', () => {
    const result = decide({ sessions: 100, crashFreeRate: 0.9 }, null)
    expect(result.pause).toBe(true)
    expect(result.reason).toMatch(/90\.00%/)
  })

  it('compares with the previous release', () => {
    // Small drops are within the allowed 2 points.
    expect(
      decide({ sessions: 100, crashFreeRate: 0.985 }, { sessions: 500, crashFreeRate: 0.999 }).pause
    ).toBe(false)
    expect(
      decide({ sessions: 100, crashFreeRate: 0.981 }, { sessions: 500, crashFreeRate: 1 }).pause
    ).toBe(false)
    // A drop bigger than the allowance pauses even though the rate is above the absolute limit.
    expect(
      decide(
        { sessions: 100, crashFreeRate: 0.985 },
        { sessions: 500, crashFreeRate: 1 },
        { maxDropFromPrevious: 0.01 }
      ).pause
    ).toBe(true)
  })

  it('ignores a previous release with too little data', () => {
    expect(
      decide(
        { sessions: 100, crashFreeRate: 0.985 },
        { sessions: 3, crashFreeRate: 1 },
        { maxDropFromPrevious: 0.001 }
      ).pause
    ).toBe(false)
  })

  it('keeps a healthy release going', () => {
    expect(decide(ok, { sessions: 500, crashFreeRate: 0.996 })).toMatchObject({
      pause: false,
      verdict: 'healthy'
    })
    expect(decide(null, null).verdict).toBe('unknown')
    expect(decide({ sessions: 100, crashFreeRate: 0.5 }, null).verdict).toBe('pause')
  })
})
