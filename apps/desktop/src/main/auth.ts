import { electronClient } from '@better-auth/electron/client'
import { storage } from '@better-auth/electron/storage'
import { createAuthClient } from 'better-auth/client'
import { app, BrowserWindow } from 'electron'
import { IPC, type Account } from '../shared/ipc'
import { parseAuthCallback } from './authLink'
import { PROTOCOL } from './deeplink'
import logger from 'electron-log/main'

// Sign-in goes through the system browser, never a form inside the app:
//   1. requestAuth() opens <API>/sign-in in the browser with a PKCE challenge and a random state.
//   2. The person signs in there (magic link by email). The site then opens `<scheme>:/auth/callback#token=...`.
//   3. We exchange that one-time code, together with the secret verifier that never left this process, for a session.
// The session cookie is stored encrypted with the operating system's keychain (Electron safeStorage).
// We use only the pieces of @better-auth/electron that run in main; its own IPC bridges, protocol registration and
// CSP rewriting are not used, because this app already has hardened versions of those (secureIpc, app://, CSP).

declare const __API_URL__: string

/** The API address baked in at build time. In development it falls back to a local `wrangler dev`. */
export function apiUrl(): string {
  return __API_URL__ || (app.isPackaged ? '' : 'http://localhost:8787')
}

export const accountAvailable = (): boolean => apiUrl() !== ''

type AuthClient = ReturnType<
  typeof createAuthClient<{ plugins: [ReturnType<typeof electronClient>] }>
>

let client: AuthClient | null = null

function makeClient(baseURL: string): AuthClient {
  return createAuthClient({
    baseURL,
    plugins: [
      electronClient({
        signInURL: `${baseURL}/sign-in`,
        protocol: { scheme: PROTOCOL },
        storage: storage()
      })
    ]
  })
}

function getClient(): AuthClient {
  client ??= makeClient(apiUrl())
  return client
}

const accountListeners = new Set<(account: Account) => void>()

/** Run `listener` whenever the signed-in person changes (sign-in or sign-out). */
export function onAccountChanged(listener: (account: Account) => void): void {
  accountListeners.add(listener)
}

function broadcast(account: Account): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(IPC.accountChanged, account)
  accountListeners.forEach((listener) => listener(account))
}

/**
 * `fetch` for the API on behalf of the signed-in person: adds the stored session cookie and the app's own origin
 * (which the Worker lists in TRUSTED_ORIGINS). Used by the typed client in main; the renderer never sees the cookie.
 */
export const authenticatedFetch: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers)
  headers.set('cookie', getClient().getCookie())
  headers.set('origin', `${PROTOCOL}:/`)
  return fetch(input, { ...init, headers })
}

export async function getAccount(): Promise<Account> {
  if (!accountAvailable()) return { available: false, user: null }
  try {
    const { data } = await getClient().getSession()
    const user = data?.user
    return { available: true, user: user ? { email: user.email, name: user.name } : null }
  } catch (error) {
    // Offline or the API is down: behave as signed out rather than failing the window.
    logger.warn('[auth] could not read the session', error)
    return { available: true, user: null }
  }
}

/** Opens the system browser on the sign-in page. The result arrives later as a deep link. */
export async function signIn(): Promise<void> {
  if (!accountAvailable()) return
  await getClient().requestAuth()
}

export async function signOut(): Promise<void> {
  if (!accountAvailable()) return
  await getClient().signOut()
  broadcast(await getAccount())
}

export const isAuthCallback = (url: string): boolean => parseAuthCallback(url, PROTOCOL) !== null

/** Finish a sign-in started by `signIn()`: swap the one-time code from the deep link for a session. */
export async function handleAuthCallback(url: string): Promise<void> {
  const token = parseAuthCallback(url, PROTOCOL)
  if (!token || !accountAvailable()) return
  try {
    const result = await getClient().authenticate({ token })
    if (result.error) logger.warn('[auth] the sign-in code was rejected', result.error)
  } catch (error) {
    logger.warn('[auth] could not finish signing in', error)
  }
  broadcast(await getAccount())
}
