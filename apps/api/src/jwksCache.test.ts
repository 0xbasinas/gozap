import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cachedJwks, forgetJwks, JWKS_KEEP_MS } from './jwksCache'

describe('cachedJwks', () => {
  beforeEach(() => forgetJwks())

  it('reads once inside the window and again after it', async () => {
    const load = vi.fn(async () => ({ keys: [] }))
    await cachedJwks(load, 1000)
    await cachedJwks(load, 1000 + JWKS_KEEP_MS - 1)
    expect(load).toHaveBeenCalledTimes(1)
    await cachedJwks(load, 1000 + JWKS_KEEP_MS)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('does not keep a failed read', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue({ keys: [] })
    await expect(cachedJwks(load, 1)).rejects.toThrow('busy')
    await expect(cachedJwks(load, 2)).resolves.toEqual({ keys: [] })
  })
})
