import { accountExportSchema, accountSchema, type Account, type AccountExport } from './schemas'
import { preferencesRecordSchema, type PreferencesRecord } from './preferences'
import { z } from 'zod'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface ApiClientOptions {
  /** Address of the API, e.g. `https://app.example.com`. Empty means "this site" (the browser). */
  baseUrl?: string
  /** Replace `fetch` (tests, or a fetch that adds an Authorization header). */
  fetch?: typeof fetch
}

/**
 * A small typed client for the API. Responses are checked with zod, so a wrong or missing field
 * fails loudly here instead of breaking a screen later. Used by the web app and the desktop app.
 */
export interface ApiClient {
  preferences: {
    get(): Promise<PreferencesRecord>
    /** Saves the preferences; the response is whichever copy is newest (the one you sent, or a newer one from another device). */
    put(record: PreferencesRecord): Promise<PreferencesRecord>
  }
  account: {
    get(): Promise<Account>
    /** Everything we hold about the signed-in person. */
    export(): Promise<AccountExport>
    /** Permanently deletes the account and its data. `confirmEmail` must be the account email. */
    remove(confirmEmail: string): Promise<void>
  }
}

export function createApiClient({
  baseUrl = '',
  fetch: fetchFn
}: ApiClientOptions = {}): ApiClient {
  async function request<T>(
    path: string,
    schema: z.ZodType<T> | null,
    init?: RequestInit
  ): Promise<T> {
    const doFetch = fetchFn ?? fetch
    const response = await doFetch(`${baseUrl}/api${path}`, {
      ...init,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init?.headers }
    })
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null)
      const message =
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof body.error === 'string'
          ? body.error
          : `Request failed (${response.status})`
      throw new ApiError(response.status, message)
    }
    if (schema === null) return undefined as T
    return schema.parse(await response.json())
  }

  return {
    preferences: {
      get: (): Promise<PreferencesRecord> => request('/preferences', preferencesRecordSchema),
      put: (record: PreferencesRecord): Promise<PreferencesRecord> =>
        request('/preferences', preferencesRecordSchema, {
          method: 'PUT',
          body: JSON.stringify(record)
        })
    },
    account: {
      get: (): Promise<Account> => request('/account', accountSchema),
      export: (): Promise<AccountExport> => request('/account/export', accountExportSchema),
      remove: (confirmEmail: string): Promise<void> =>
        request('/account', null, { method: 'DELETE', body: JSON.stringify({ confirmEmail }) })
    }
  }
}
