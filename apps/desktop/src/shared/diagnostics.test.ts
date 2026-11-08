import { describe, expect, it } from 'vitest'
import { buildReport, redactHome, tailLines, type DiagnosticsInput } from './diagnostics'

const input: DiagnosticsInput = {
  app: { name: 'Demo', version: '1.2.3', packaged: true },
  system: { platform: 'win32', arch: 'x64', osVersion: '10.0', locale: 'en-US' },
  versions: { electron: '1', chrome: '2', node: '3' },
  gpu: { webgl: 'enabled' },
  memoryMB: { rss: 100, heapUsed: 50 },
  settings: { theme: 'dark', notifications: true },
  logPath: 'C:\\Users\\ada\\AppData\\Roaming\\Demo\\logs\\main.log',
  logTail: 'error in C:\\Users\\ada\\file.txt'
}

describe('redactHome', () => {
  it('replaces the home folder in every spelling', () => {
    const home = 'C:\\Users\\ada'
    expect(
      redactHome('C:\\Users\\ada\\x and C:/Users/ada/y and C:\\\\Users\\\\ada\\\\z', home)
    ).toBe('~\\x and ~/y and ~\\\\z')
  })
  it('leaves the text alone with no home folder', () => {
    expect(redactHome('abc', '')).toBe('abc')
  })
})

describe('tailLines', () => {
  it('keeps the last lines', () => {
    expect(tailLines('a\nb\nc\nd', 2)).toBe('c\nd')
  })
  it('drops a line that was cut in half', () => {
    expect(tailLines('rt of a line\nb\nc', 5, true)).toBe('b\nc')
  })
})

describe('buildReport', () => {
  const report = buildReport(input, 'C:\\Users\\ada')
  it('lists the sections', () => {
    for (const title of ['App', 'System', 'Versions', 'GPU', 'Memory (MB)', 'Settings']) {
      expect(report).toContain(`## ${title}`)
    }
    expect(report).toContain('version: 1.2.3')
    expect(report).toContain('theme: dark')
  })
  it('never contains the home folder', () => {
    expect(report).not.toContain('ada')
  })
  it('handles missing GPU info and an empty log', () => {
    const empty = buildReport({ ...input, gpu: {}, logTail: '' }, '')
    expect(empty).toContain('status: not available')
    expect(empty).toContain('(empty)')
  })
})
