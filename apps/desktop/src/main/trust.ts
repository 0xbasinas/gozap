import { is } from '@electron-toolkit/utils'
import { APP_HOST, APP_SCHEME } from './appPath'

/** True only for the app's own pages (any hash), never for remote or unexpected URLs. */
export function isTrustedUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // Development: the Vite dev server. Production: our own app://renderer scheme.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) return parsed.origin === new URL(devUrl).origin

  return (
    parsed.protocol === `${APP_SCHEME}:` &&
    parsed.host === APP_HOST &&
    (parsed.pathname === '/' || parsed.pathname === '/index.html')
  )
}
