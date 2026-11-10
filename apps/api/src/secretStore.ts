/**
 * Keeps a company's OpenID Connect client secret encrypted in the database. The single sign-on plugin stores the
 * secret inside the provider row as plain JSON, so this wraps the database adapter: the secret is encrypted (AES-GCM,
 * key derived from BETTER_AUTH_SECRET) when a provider row is written and decrypted when one is read. A copy of the
 * database alone no longer reveals the secrets; the Worker secret is needed too.
 */
const PREFIX = 'enc:v1:'
const MODEL = 'ssoProvider'

const toBase64 = (bytes: Uint8Array): string => {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text)
}
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

async function keyFor(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${secret}:sso-client-secret`)
  )
  return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function sealSecret(secret: string, plain: string): Promise<string> {
  if (plain.startsWith(PREFIX)) return plain
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await keyFor(secret),
      new TextEncoder().encode(plain)
    )
  )
  const out = new Uint8Array(iv.length + sealed.length)
  out.set(iv)
  out.set(sealed, iv.length)
  return PREFIX + toBase64(out)
}

export async function openSecret(secret: string, stored: string): Promise<string> {
  if (!stored.startsWith(PREFIX)) return stored
  const raw = fromBase64(stored.slice(PREFIX.length))
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: raw.slice(0, 12) },
    await keyFor(secret),
    raw.slice(12)
  )
  return new TextDecoder().decode(plain)
}

type Row = Record<string, unknown>

async function mapConfig(row: Row, change: (value: string) => Promise<string>): Promise<Row> {
  if (typeof row.oidcConfig !== 'string') return row
  try {
    const config = JSON.parse(row.oidcConfig) as { clientSecret?: unknown }
    if (typeof config.clientSecret !== 'string' || !config.clientSecret) return row
    config.clientSecret = await change(config.clientSecret)
    return { ...row, oidcConfig: JSON.stringify(config) }
  } catch {
    return row
  }
}

interface Args {
  model: string
  data?: Row
  update?: Row
  [key: string]: unknown
}
type Method = (args: Args) => Promise<unknown>

/** Wraps a Better Auth database adapter factory so the provider's client secret is encrypted at rest. */
export function withEncryptedProviderSecrets<A extends (options: never) => object>(
  inner: A,
  secret: string,
  /** Runs before any row is created; throw to refuse it. Every plugin writes through here, so nothing can skip it. */
  beforeCreate?: (model: string, data: Row) => Promise<void>
): A {
  const wrapped = ((options: never) => {
    const adapter = inner(options) as Record<string, Method>
    const seal = (value: string): Promise<string> => sealSecret(secret, value)
    const open = (value: string): Promise<string> => openSecret(secret, value)
    const readRow = async (row: unknown): Promise<unknown> =>
      row && typeof row === 'object' ? mapConfig(row as Row, open) : row
    const result: Record<string, unknown> = {
      ...adapter,
      create: async (args: Args) => {
        if (beforeCreate && args.data) await beforeCreate(args.model, args.data)
        return readRow(
          await adapter.create!(
            args.model === MODEL && args.data
              ? { ...args, data: await mapConfig(args.data, seal) }
              : args
          )
        )
      },
      update: async (args: Args) =>
        readRow(
          await adapter.update!(
            args.model === MODEL && args.update
              ? { ...args, update: await mapConfig(args.update, seal) }
              : args
          )
        ),
      findOne: async (args: Args) =>
        args.model === MODEL ? readRow(await adapter.findOne!(args)) : adapter.findOne!(args),
      findMany: async (args: Args) => {
        const rows = await adapter.findMany!(args)
        return args.model === MODEL && Array.isArray(rows) ? Promise.all(rows.map(readRow)) : rows
      }
    }
    // D1 has no transactions, so Better Auth's fallback just runs the callback on the adapter it holds. Without this the
    // callback would get the unwrapped adapter, and writes made inside it (invitations, single sign-on) would skip us.
    result.transaction = async (callback: (adapter: unknown) => Promise<unknown>) =>
      callback(result)
    return result
  }) as unknown as A
  return wrapped
}
