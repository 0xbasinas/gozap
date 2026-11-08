import { describe, expect, it } from 'vitest'
import { describeSync, timeAgo } from './syncStatus'

const NOW = 1_000_000_000_000
const ago = (ms: number): number => NOW - ms

describe('timeAgo', () => {
  it('says "just now" for the first half minute', () => {
    expect(timeAgo(ago(0), NOW)).toBe('just now')
    expect(timeAgo(ago(29_000), NOW)).toBe('just now')
  })
  it('counts minutes, hours and days', () => {
    expect(timeAgo(ago(60_000), NOW)).toBe('1 minute ago')
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe('5 minutes ago')
    expect(timeAgo(ago(2 * 3_600_000), NOW)).toBe('2 hours ago')
    expect(timeAgo(ago(3 * 86_400_000), NOW)).toBe('3 days ago')
  })
  it('never goes negative when the clock moved', () => {
    expect(timeAgo(NOW + 5_000, NOW)).toBe('just now')
  })
})

describe('describeSync', () => {
  it('explains each state', () => {
    expect(describeSync({ state: 'signed-out', lastSyncedAt: null }, NOW)).toMatch(/Signed out/)
    expect(describeSync({ state: 'syncing', lastSyncedAt: null }, NOW)).toBe('Syncing...')
    expect(describeSync({ state: 'synced', lastSyncedAt: ago(0) }, NOW)).toBe('Synced just now.')
    expect(describeSync({ state: 'synced', lastSyncedAt: null }, NOW)).toBe('Synced.')
  })
  it('mentions the last good sync when offline', () => {
    expect(describeSync({ state: 'offline', lastSyncedAt: null }, NOW)).toMatch(/^Offline/)
    expect(describeSync({ state: 'offline', lastSyncedAt: ago(10 * 60_000) }, NOW)).toContain(
      'Last synced 10 minutes ago'
    )
  })
})
