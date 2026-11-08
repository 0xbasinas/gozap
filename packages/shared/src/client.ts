import { accountExportSchema, accountSchema, type Account, type AccountExport } from './schemas'
import { preferencesRecordSchema, type PreferencesRecord } from './preferences'
import {
  cancelDeletionInputSchema,
  deletionScheduledSchema,
  type DeletionScheduled
} from './deletion'
import { devicesSchema, type Device } from './devices'
import { feedbackReceiptSchema, type FeedbackInput } from './feedback'
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
  devices: {
    /** Where the person is signed in (one entry per session). */
    list(): Promise<Device[]>
    /** Gives a device a name, or removes it with `null`. */
    rename(id: string, nickname: string | null): Promise<void>
    /** Signs that device out. The current one cannot be removed this way (sign out instead). */
    signOut(id: string): Promise<void>
  }
  feedback: {
    /** Sends feedback as the signed-in person. Resolves with the id of the stored message. */
    send(input: FeedbackInput): Promise<{ id: string }>
  }
  account: {
    get(): Promise<Account>
    /** Everything we hold about the signed-in person. */
    export(): Promise<AccountExport>
    /** Asks to delete the account. It is removed after the cooling-off period unless cancelled. `confirmEmail` must be the account email. */
    remove(confirmEmail: string): Promise<DeletionScheduled>
    /** Keeps the account after all (signed in). */
    cancelDeletion(): Promise<void>
    /** Keeps the account using the token from the email (no sign-in needed). */
    cancelDeletionWithToken(token: string): Promise<void>
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
    devices: {
      list: (): Promise<Device[]> => request('/devices', devicesSchema),
      rename: (id: string, nickname: string | null): Promise<void> =>
        request(`/devices/${encodeURIComponent(id)}`, null, {
          method: 'PATCH',
          body: JSON.stringify({ nickname })
        }),
      signOut: (id: string): Promise<void> =>
        request(`/devices/${encodeURIComponent(id)}`, null, { method: 'DELETE' })
    },
    feedback: {
      send: (input: FeedbackInput): Promise<{ id: string }> =>
        request('/feedback', feedbackReceiptSchema, { method: 'POST', body: JSON.stringify(input) })
    },
    account: {
      get: (): Promise<Account> => request('/account', accountSchema),
      export: (): Promise<AccountExport> => request('/account/export', accountExportSchema),
      remove: (confirmEmail: string): Promise<DeletionScheduled> =>
        request('/account', deletionScheduledSchema, {
          method: 'DELETE',
          body: JSON.stringify({ confirmEmail })
        }),
      cancelDeletion: (): Promise<void> =>
        request('/account/deletion/cancel', null, { method: 'POST' }),
      cancelDeletionWithToken: (token: string): Promise<void> =>
        request('/account/deletion/cancel-with-token', null, {
          method: 'POST',
          body: JSON.stringify(cancelDeletionInputSchema.parse({ token }))
        })
    }
  }
}
