import { describe, expect, it } from 'vitest'
import { checkManifest, parseManifest } from './manifest.mjs'

const text = `version: 1.2.3
files:
  - url: app-1.2.3-setup.exe
    sha512: AAA==
    size: 100
path: app-1.2.3-setup.exe
sha512: AAA==
releaseDate: '2026-11-07T00:00:00.000Z'
`

const build = (overrides = {}) => ({
  version: '1.2.3',
  files: new Map([
    ['app-1.2.3-setup.exe', { size: 100, sha512: 'AAA==' }],
    ['app-1.2.3-setup.exe.blockmap', { size: 10, sha512: 'B' }]
  ]),
  ...overrides
})

describe('parseManifest', () => {
  it('reads the fields electron-builder writes', () => {
    expect(parseManifest(text)).toEqual({
      version: '1.2.3',
      files: [{ url: 'app-1.2.3-setup.exe', sha512: 'AAA==', size: 100 }],
      path: 'app-1.2.3-setup.exe',
      sha512: 'AAA==',
      releaseDate: '2026-11-07T00:00:00.000Z'
    })
  })

  it('reads several files and a rollout percentage', () => {
    const manifest = parseManifest(
      'version: 1\nfiles:\n  - url: a.zip\n    sha512: x\n    size: 1\n  - url: b.dmg\n    sha512: y\n    size: 2\nstagingPercentage: 10\n'
    )
    expect(manifest.files.map((f) => f.url)).toEqual(['a.zip', 'b.dmg'])
    expect(manifest.stagingPercentage).toBe(10)
  })

  it('copes with Windows line endings', () => {
    expect(parseManifest(text.replace(/\n/g, '\r\n')).files).toHaveLength(1)
  })
})

describe('checkManifest', () => {
  it('accepts a consistent build', () => {
    expect(checkManifest(parseManifest(text), build())).toEqual([])
  })

  it('catches a wrong version, size and hash', () => {
    const files = new Map([
      ['app-1.2.3-setup.exe', { size: 99, sha512: 'ZZZ==' }],
      ['app-1.2.3-setup.exe.blockmap', { size: 10, sha512: 'B' }]
    ])
    const problems = checkManifest(parseManifest(text), build({ version: '9.9.9', files }))
    expect(problems.join('\n')).toMatch(/manifest version is 1.2.3/)
    expect(problems.join('\n')).toMatch(/size 100, file size 99/)
    expect(problems.join('\n')).toMatch(/sha512 in the manifest does not match/)
  })

  it('catches a missing installer and a missing blockmap', () => {
    expect(checkManifest(parseManifest(text), build({ files: new Map() }))[0]).toMatch(
      /not in the build folder/
    )
    const noBlockmap = new Map([['app-1.2.3-setup.exe', { size: 100, sha512: 'AAA==' }]])
    expect(checkManifest(parseManifest(text), build({ files: noBlockmap })).join()).toMatch(
      /blockmap/
    )
  })

  it('does not ask AppImages for a blockmap', () => {
    const appImage =
      'version: 1.2.3\nfiles:\n  - url: app-1.2.3.AppImage\n    sha512: A\n    size: 5\n'
    const files = new Map([['app-1.2.3.AppImage', { size: 5, sha512: 'A' }]])
    expect(checkManifest(parseManifest(appImage), { version: '1.2.3', files })).toEqual([])
  })

  it('rejects a fresh build that already has a rollout percentage', () => {
    expect(checkManifest(parseManifest(text + 'stagingPercentage: 10\n'), build()).join()).toMatch(
      /stagingPercentage/
    )
  })
})
