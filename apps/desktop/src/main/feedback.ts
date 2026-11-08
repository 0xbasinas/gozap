import { app } from 'electron'
import { FEEDBACK_DIAGNOSTICS_MAX, type FeedbackKind } from '@repo/shared'
import { createApiClient } from '@repo/shared/client'
import type { FeedbackResult } from '../shared/ipc'
import logger from 'electron-log/main'
import { accountAvailable, apiUrl, authenticatedFetch, getAccount } from './auth'
import { collectDiagnostics } from './diagnostics'

/** Send feedback as the signed-in person. The session never leaves this process; the page only gets "sent" or a reason. */
export async function sendFeedback(request: {
  kind: FeedbackKind
  message: string
  includeDiagnostics: boolean
}): Promise<FeedbackResult> {
  if (!accountAvailable()) return { ok: false, error: 'This build is not connected to an account.' }
  if (!(await getAccount()).user)
    return { ok: false, error: 'Sign in first, then send your feedback.' }
  try {
    const api = createApiClient({ baseUrl: apiUrl(), fetch: authenticatedFetch })
    await api.feedback.send({
      kind: request.kind,
      message: request.message,
      source: 'desktop',
      appVersion: app.getVersion().slice(0, 64),
      platform: process.platform,
      diagnostics: request.includeDiagnostics
        ? collectDiagnostics().slice(0, FEEDBACK_DIAGNOSTICS_MAX)
        : undefined
    })
    return { ok: true }
  } catch (error) {
    logger.warn('[feedback] could not send', error)
    // The API's own message (for example the hourly limit) is safe to show; anything else gets a general one.
    const message = error instanceof Error && error.name === 'ApiError' ? error.message : null
    return {
      ok: false,
      error: message ?? 'Could not send your feedback. Check your connection and try again.'
    }
  }
}
