import {
  accountExportSchema,
  accountSchema,
  securityEventsSchema,
  type Account,
  type AccountExport,
  type SecurityEvent
} from './schemas'
import { preferencesRecordSchema, type PreferencesRecord } from './preferences'
import {
  cancelDeletionInputSchema,
  deletionScheduledSchema,
  type DeletionScheduled
} from './deletion'
import {
  changeEmailInputSchema,
  confirmEmailChangeInputSchema,
  emailChangedSchema,
  type EmailChanged
} from './emailChange'
import { flagsSchema, type FlagChannel, type Flags } from './flags'
import { appConfigSchema, type AppConfig } from './version'
import {
  consentsSchema,
  setConsentInputSchema,
  type ConsentPurpose,
  type Consents
} from './consents'
import { dataRequestsSchema, type DataRequest } from './dataRequests'
import { privacySummarySchema, type PrivacySummary } from './privacy'
import { signInsSchema, type SignIn } from './signIns'
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
  /** Which feature flags are on for this install (its channel and a random install id; no sign-in needed). */
  flags(channel: FlagChannel, installId?: string): Promise<Flags>
  /** What the app needs to know before anything else (the oldest version still allowed). No sign-in needed. */
  appConfig(): Promise<AppConfig>
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
    /** Requests about personal data (export, deletion) with their status and deadline. */
    consents(): Promise<Consents>
    /** Agree to or withdraw a purpose; adds an entry to the ledger. */
    setConsent(purpose: ConsentPurpose, granted: boolean): Promise<Consents>
    requests(): Promise<DataRequest[]>
    /** How much of each kind of data we hold about the signed-in person. */
    privacy(): Promise<PrivacySummary>
    /** The last sign-ins to the account, newest first. */
    signIns(): Promise<SignIn[]>
    securityActivity(): Promise<SecurityEvent[]>
    /** Asks to move the account to a new address. A link goes to the new address; nothing changes until it is used. */
    changeEmail(newEmail: string): Promise<void>
    /** Finishes the change with the token from the email (no sign-in needed). */
    confirmEmailChange(token: string): Promise<EmailChanged>
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
    flags: (channel: FlagChannel, installId?: string): Promise<Flags> =>
      request(
        `/flags?channel=${channel}${installId ? `&id=${encodeURIComponent(installId)}` : ''}`,
        flagsSchema
      ),
    appConfig: (): Promise<AppConfig> => request('/app-config', appConfigSchema),
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
        }),
      consents: (): Promise<Consents> => request('/account/consents', consentsSchema),
      setConsent: (purpose: ConsentPurpose, granted: boolean): Promise<Consents> =>
        request('/account/consents', consentsSchema, {
          method: 'POST',
          body: JSON.stringify(setConsentInputSchema.parse({ purpose, granted }))
        }),
      requests: (): Promise<DataRequest[]> => request('/account/requests', dataRequestsSchema),
      privacy: (): Promise<PrivacySummary> => request('/account/privacy', privacySummarySchema),
      signIns: (): Promise<SignIn[]> => request('/account/sign-ins', signInsSchema),
      securityActivity: (): Promise<SecurityEvent[]> =>
        request('/account/security-activity', securityEventsSchema),
      changeEmail: (newEmail: string): Promise<void> =>
        request('/account/email-change', null, {
          method: 'POST',
          body: JSON.stringify(changeEmailInputSchema.parse({ newEmail }))
        }),
      confirmEmailChange: (token: string): Promise<EmailChanged> =>
        request('/account/email-change/confirm', emailChangedSchema, {
          method: 'POST',
          body: JSON.stringify(confirmEmailChangeInputSchema.parse({ token }))
        })
    }
  }
}
