import { createApiClient } from '@repo/shared/client'
import type { ActionResult, DevicesResult } from '../shared/ipc'
import logger from 'electron-log/main'
import { accountAvailable, apiUrl, authenticatedFetch, getAccount } from './auth'

// The device list for Settings. Like feedback, the main process makes the calls as the signed-in person.

async function client(): Promise<ReturnType<typeof createApiClient> | string> {
  if (!accountAvailable()) return 'This build is not connected to an account.'
  if (!(await getAccount()).user) return 'Sign in first.'
  return createApiClient({ baseUrl: apiUrl(), fetch: authenticatedFetch })
}

/** The API's own message (for example "not found") is safe to show; anything else gets a general one. */
function reason(error: unknown): string {
  logger.warn('[devices] request failed', error)
  return error instanceof Error && error.name === 'ApiError'
    ? error.message
    : 'Could not reach the server. Check your connection and try again.'
}

export async function listDevices(): Promise<DevicesResult> {
  const api = await client()
  if (typeof api === 'string') return { ok: false, error: api }
  try {
    return { ok: true, devices: await api.devices.list() }
  } catch (error) {
    return { ok: false, error: reason(error) }
  }
}

export async function renameDevice(id: string, nickname: string | null): Promise<ActionResult> {
  const api = await client()
  if (typeof api === 'string') return { ok: false, error: api }
  try {
    await api.devices.rename(id, nickname)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: reason(error) }
  }
}

export async function signOutDevice(id: string): Promise<ActionResult> {
  const api = await client()
  if (typeof api === 'string') return { ok: false, error: api }
  try {
    await api.devices.signOut(id)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: reason(error) }
  }
}
