import { describe, expect, it } from 'vitest'
import { nextRollout, scheduledPercent } from './promote.mjs'

describe('scheduledPercent', () => {
  it('follows the schedule by age', () => {
    expect(scheduledPercent(1)).toBeNull()
    expect(scheduledPercent(24)).toBe(25)
    expect(scheduledPercent(47)).toBe(25)
    expect(scheduledPercent(60)).toBe(50)
    expect(scheduledPercent(200)).toBe(100)
  })
})

describe('nextRollout', () => {
  const healthy = { verdict: 'healthy' }

  it('raises a healthy release when the schedule is ahead of it', () => {
    expect(nextRollout({ ageHours: 30, current: 10, ...healthy }).percent).toBe(25)
    expect(nextRollout({ ageHours: 80, current: 25, ...healthy }).percent).toBe(100)
  })

  it('does nothing when it is too early or already far enough', () => {
    expect(nextRollout({ ageHours: 5, current: 10, ...healthy }).percent).toBeNull()
    expect(nextRollout({ ageHours: 30, current: 50, ...healthy }).percent).toBeNull()
  })

  it('never touches a paused or finished rollout', () => {
    expect(nextRollout({ ageHours: 100, current: 0, ...healthy }).percent).toBeNull()
    expect(nextRollout({ ageHours: 100, current: 100, ...healthy }).percent).toBeNull()
  })

  it('does not promote a release the guard flagged', () => {
    expect(nextRollout({ ageHours: 100, current: 10, verdict: 'pause' }).percent).toBeNull()
    expect(nextRollout({ ageHours: 100, current: 10, verdict: 'paused' }).percent).toBeNull()
  })

  it('needs crash data unless told otherwise', () => {
    expect(nextRollout({ ageHours: 100, current: 10, verdict: 'unknown' }).percent).toBeNull()
    expect(
      nextRollout({ ageHours: 100, current: 10, verdict: 'unknown', allowWithoutData: true })
        .percent
    ).toBe(100)
  })
})
