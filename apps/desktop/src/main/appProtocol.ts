import { protocol } from 'electron'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { APP_HOST, APP_SCHEME, mimeType, resolveAppFile } from './appPath'

// In production the UI is served from app://renderer/ instead of file://. A custom scheme means the page
// gets only the privileges we give it, so the grantFileProtocolExtraPrivileges fuse can stay off, and
// every request goes through resolveAppFile, which cannot be tricked into reading outside the bundle.

/** Must run before the app is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // standard + secure make it behave like https for storage, CORS and module scripts.
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Start answering app:// requests. Call once the app is ready, before the first window loads. */
export function serveRenderer(): void {
  const root = join(__dirname, '../renderer')

  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 })

    const file = resolveAppFile(root, url.pathname)
    if (!file) return new Response('Forbidden', { status: 403 })

    try {
      const body = await readFile(file)
      return new Response(new Uint8Array(body), {
        headers: { 'content-type': mimeType(file), 'x-content-type-options': 'nosniff' }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
