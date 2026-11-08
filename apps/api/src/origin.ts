import { createMiddleware } from 'hono/factory'
import { HTTPException } from 'hono/http-exception'
import type { Bindings } from './env'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** The origins allowed to change data: our own site plus any listed in TRUSTED_ORIGINS. */
export function allowedOrigins(
  env: Pick<Bindings, 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS'>
): string[] {
  const extra = (env.TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim())
  return [env.BETTER_AUTH_URL, ...extra].filter(Boolean).map((o) => {
    try {
      const { origin } = new URL(o)
      // Custom schemes (myapp://) have an opaque origin; keep them as written.
      return origin === 'null' ? o : origin
    } catch {
      return o
    }
  })
}

/**
 * Defence in depth against cross-site requests: a change (POST, PUT, DELETE ...) that carries an Origin
 * header must come from our own site. Browsers always send Origin on cross-site writes; scripts and the
 * desktop app send none, and they are not a CSRF risk because they do not ride on the browser's cookies.
 */
export const sameOriginOnly = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
  const origin = c.req.header('origin')
  if (!SAFE_METHODS.has(c.req.method) && origin && !allowedOrigins(c.env).includes(origin)) {
    throw new HTTPException(403, { message: 'Cross-site request blocked' })
  }
  await next()
})
