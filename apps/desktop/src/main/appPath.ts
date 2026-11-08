import { extname, resolve, sep } from 'path'

/** The scheme and host the packaged app is served from: app://renderer/index.html. */
export const APP_SCHEME = 'app'
export const APP_HOST = 'renderer'
export const APP_URL = `${APP_SCHEME}://${APP_HOST}/index.html`

/**
 * Map the path part of an app:// URL to a file inside `root`, or null when it would escape it
 * (for example `/../../secret`, or an encoded `%2e%2e`). `/` means index.html.
 */
export function resolveAppFile(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null

  const base = resolve(root)
  const file = resolve(base, '.' + (decoded === '/' ? '/index.html' : decoded))
  return file === base || file.startsWith(base + sep) ? file : null
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

export function mimeType(file: string): string {
  return MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
}
