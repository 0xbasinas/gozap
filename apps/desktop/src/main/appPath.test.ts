import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { mimeType, resolveAppFile } from './appPath'

const root = resolve('/app/renderer')

describe('resolveAppFile', () => {
  it('serves index.html for the root', () => {
    expect(resolveAppFile(root, '/')).toBe(join(root, 'index.html'))
  })

  it('maps normal asset paths into the folder', () => {
    expect(resolveAppFile(root, '/assets/index-abc.js')).toBe(join(root, 'assets', 'index-abc.js'))
    expect(resolveAppFile(root, '/assets/my%20font.woff2')).toBe(
      join(root, 'assets', 'my font.woff2')
    )
  })

  it('refuses to leave the folder', () => {
    expect(resolveAppFile(root, '/../secret.txt')).toBeNull()
    expect(resolveAppFile(root, '/assets/../../secret.txt')).toBeNull()
    expect(resolveAppFile(root, '/%2e%2e/secret.txt')).toBeNull()
    expect(resolveAppFile(root, '/..%2f..%2fsecret.txt')).toBeNull()
  })

  it('refuses a sibling folder that merely starts with the same name', () => {
    expect(resolveAppFile(root, '/../renderer-evil/x.js')).toBeNull()
  })

  it('refuses malformed paths', () => {
    expect(resolveAppFile(root, '/%E0%A4%A')).toBeNull()
    expect(resolveAppFile(root, '/index.html%00.png')).toBeNull()
  })
})

describe('mimeType', () => {
  it('knows the types the renderer uses', () => {
    expect(mimeType('a.html')).toMatch(/text\/html/)
    expect(mimeType('a.JS')).toMatch(/javascript/)
    expect(mimeType('a.css')).toMatch(/text\/css/)
    expect(mimeType('a.png')).toBe('image/png')
    expect(mimeType('a.unknown')).toBe('application/octet-stream')
  })
})
