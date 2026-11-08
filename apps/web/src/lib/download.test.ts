import { describe, expect, it } from 'vitest'
import {
  detectPlatform,
  filterReleases,
  formatSize,
  parseRelease,
  parseReleases,
  pickAsset,
  pickChecksums
} from './download'

const asset = (name: string): { name: string; browser_download_url: string; size: number } => ({
  name,
  browser_download_url: `https://x/${name}`,
  size: 1
})

describe('detectPlatform', () => {
  it('recognises desktop systems', () => {
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows')
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('mac')
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
  it('offers nothing on phones', () => {
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBeNull()
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14)')).toBeNull()
  })
})

describe('pickAsset', () => {
  const assets = [
    asset('app-1.0.0-setup.exe'),
    asset('app-1.0.0-setup.exe.blockmap'),
    asset('app-1.0.0.dmg'),
    asset('app-1.0.0.AppImage'),
    asset('latest.yml'),
    asset('SHA256SUMS.txt')
  ]
  it('picks the installer for each system', () => {
    expect(pickAsset(assets, 'windows')?.name).toBe('app-1.0.0-setup.exe')
    expect(pickAsset(assets, 'mac')?.name).toBe('app-1.0.0.dmg')
    expect(pickAsset(assets, 'linux')?.name).toBe('app-1.0.0.AppImage')
  })
  it('returns null when there is none', () => {
    expect(pickAsset([asset('latest.yml')], 'windows')).toBeNull()
  })
})

describe('parseRelease', () => {
  it('accepts a normal release and drops malformed or non-https assets', () => {
    const r = parseRelease({
      tag_name: 'v1.2.3',
      html_url: 'https://github.com/o/r/releases/tag/v1.2.3',
      assets: [
        asset('a.exe'),
        { name: 'bad' },
        { ...asset('b.exe'), browser_download_url: 'http://x/b.exe' }
      ]
    })
    expect(r?.assets.map((a) => a.name)).toEqual(['a.exe'])
  })
  it('rejects anything else', () => {
    expect(parseRelease(null)).toBeNull()
    expect(parseRelease({ tag_name: 1 })).toBeNull()
    expect(parseRelease('x')).toBeNull()
  })
})

describe('pickChecksums', () => {
  it('finds the SHA256SUMS file', () => {
    expect(pickChecksums([asset('a.exe'), asset('SHA256SUMS.txt')])?.name).toBe('SHA256SUMS.txt')
    expect(pickChecksums([asset('a.exe')])).toBeNull()
  })
})

describe('formatSize', () => {
  it('uses KB and MB', () => {
    expect(formatSize(10)).toBe('1 KB')
    expect(formatSize(2048)).toBe('2 KB')
    expect(formatSize(88 * 1024 * 1024)).toBe('88.0 MB')
  })
})

describe('releases list', () => {
  const rel = (tag: string, prerelease: boolean): unknown => ({
    tag_name: tag,
    html_url: 'https://github.com/o/r/releases/tag/' + tag,
    assets: [],
    prerelease,
    published_at: '2026-01-01T00:00:00Z'
  })
  const list = parseReleases([
    rel('v2', false),
    rel('v2-beta', true),
    { nope: 1 },
    rel('v1', false)
  ])
  it('drops malformed entries and non-arrays', () => {
    expect(list.map((r) => r.tag_name)).toEqual(['v2', 'v2-beta', 'v1'])
    expect(parseReleases({})).toEqual([])
  })
  it('filters by channel', () => {
    expect(filterReleases(list, 'stable').map((r) => r.tag_name)).toEqual(['v2', 'v1'])
    expect(filterReleases(list, 'beta').map((r) => r.tag_name)).toEqual(['v2-beta'])
    expect(filterReleases(list, 'all')).toHaveLength(3)
  })
})
