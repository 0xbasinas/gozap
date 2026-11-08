import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient } from './client'

const record = { preferences: { theme: 'dark', accent: 'neutral' }, updatedAt: 5 }
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createApiClient', () => {
  it('reads preferences from /api/preferences and validates them', async () => {
    const fetchFn = vi.fn().mockResolvedValue(json(record))
    const api = createApiClient({ baseUrl: 'https://x.test', fetch: fetchFn })
    expect(await api.preferences.get()).toEqual(record)
    expect(fetchFn.mock.calls[0]![0]).toBe('https://x.test/api/preferences')
    expect(fetchFn.mock.calls[0]![1].credentials).toBe('include')
  })

  it('rejects a response that does not match the schema', async () => {
    const api = createApiClient({ fetch: vi.fn().mockResolvedValue(json({ theme: 1 })) })
    await expect(api.preferences.get()).rejects.toThrow()
  })

  it('turns error responses into ApiError with the server message', async () => {
    const api = createApiClient({
      fetch: vi.fn().mockResolvedValue(json({ error: 'Sign in first' }, 401))
    })
    await expect(api.preferences.get()).rejects.toMatchObject({
      status: 401,
      message: 'Sign in first'
    })
    await expect(api.preferences.get()).rejects.toBeInstanceOf(ApiError)
  })

  it('saves preferences and deletes the account', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json(record))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const api = createApiClient({ fetch: fetchFn })
    expect(await api.preferences.put(record as never)).toEqual(record)
    await api.account.remove('me@example.com')
    expect(fetchFn.mock.calls[1]![0]).toBe('/api/account')
    expect(fetchFn.mock.calls[1]![1].method).toBe('DELETE')
  })
})
