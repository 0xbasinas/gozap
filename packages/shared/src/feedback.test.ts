import { describe, expect, it } from 'vitest'
import { FEEDBACK_MESSAGE_MAX, feedbackInputSchema } from './feedback'

const ok = { kind: 'bug', message: 'It crashes when I open settings', source: 'web' }

describe('feedbackInputSchema', () => {
  it('accepts a normal message and trims it', () => {
    const parsed = feedbackInputSchema.parse({ ...ok, message: '  hello there  ' })
    expect(parsed.message).toBe('hello there')
  })
  it('rejects empty, too short and too long messages', () => {
    for (const message of ['', '  ', 'hi', 'x'.repeat(FEEDBACK_MESSAGE_MAX + 1)]) {
      expect(feedbackInputSchema.safeParse({ ...ok, message }).success).toBe(false)
    }
  })
  it('rejects unknown kinds and sources', () => {
    expect(feedbackInputSchema.safeParse({ ...ok, kind: 'rant' }).success).toBe(false)
    expect(feedbackInputSchema.safeParse({ ...ok, source: 'fax' }).success).toBe(false)
  })
  it('limits the size of the diagnostics report', () => {
    expect(feedbackInputSchema.safeParse({ ...ok, diagnostics: 'x'.repeat(30000) }).success).toBe(
      false
    )
  })
})
