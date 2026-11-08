import { describe, expect, it } from 'vitest'
import { DEVICE_NICKNAME_MAX, describeDevice, renameDeviceInputSchema } from './devices'

describe('describeDevice', () => {
  const cases: [string, string][] = [
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
      'Chrome on Windows'
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
      'Edge on Windows'
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      'Safari on macOS'
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox on Linux'],
    [
      'my-app/1.0.0 Chrome/152.0.7977.169 Electron/44.10.2 Safari/537.36 (Windows NT 10.0)',
      'Desktop app on Windows'
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      'Safari on iOS'
    ]
  ]
  it.each(cases)('names %s', (agent, label) => {
    expect(describeDevice(agent)).toBe(label)
  })
  it('falls back when there is nothing to go on', () => {
    expect(describeDevice(null)).toBe('Unknown device')
    expect(describeDevice('')).toBe('Unknown device')
    expect(describeDevice('curl/8.0')).toBe('Unknown device')
  })
})

describe('renameDeviceInputSchema', () => {
  it('accepts a name, trims it, and allows clearing it', () => {
    expect(renameDeviceInputSchema.parse({ nickname: '  Work laptop ' }).nickname).toBe(
      'Work laptop'
    )
    expect(renameDeviceInputSchema.parse({ nickname: null }).nickname).toBeNull()
  })
  it('rejects a name that is too long or not text', () => {
    expect(
      renameDeviceInputSchema.safeParse({ nickname: 'x'.repeat(DEVICE_NICKNAME_MAX + 1) }).success
    ).toBe(false)
    expect(renameDeviceInputSchema.safeParse({ nickname: 5 }).success).toBe(false)
  })
})
