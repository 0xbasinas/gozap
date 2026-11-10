import { describe, expect, it } from 'vitest'
import { checkPrivateKey } from './privateKey'

async function pem(algorithm: object): Promise<string> {
  const pair = (await crypto.subtle.generateKey(algorithm as never, true, [
    'sign',
    'verify'
  ])) as CryptoKeyPair
  const der = new Uint8Array(
    (await crypto.subtle.exportKey('pkcs8', pair.privateKey)) as ArrayBuffer
  )
  let text = ''
  for (const b of der) text += String.fromCharCode(b)
  const lines = btoa(text)
    .match(/.{1,64}/g)!
    .join('\n')
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----\n`
}

describe('private key for company sign-in', () => {
  it('accepts a PKCS#8 key that fits the signing method', async () => {
    const rsa = await pem({
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256'
    })
    expect(await checkPrivateKey(rsa, 'RS256')).toBeNull()
    const ec = await pem({ name: 'ECDSA', namedCurve: 'P-256' })
    expect(await checkPrivateKey(ec, 'ES256')).toBeNull()
  })

  it('refuses a key of the wrong kind, a public key, junk and an unknown method', async () => {
    const ec = await pem({ name: 'ECDSA', namedCurve: 'P-256' })
    expect(await checkPrivateKey(ec, 'RS256')).toMatch(/not a usable RS256/)
    expect(
      await checkPrivateKey('-----BEGIN PUBLIC KEY-----\nabc\n-----END PUBLIC KEY-----', 'RS256')
    ).toMatch(/PKCS#8/)
    expect(await checkPrivateKey('hunter2', 'RS256')).toMatch(/PKCS#8/)
    expect(await checkPrivateKey(ec, 'HS256')).toMatch(/Choose RS256/)
    expect(await checkPrivateKey(undefined, 'RS256')).toMatch(/Paste the private key/)
    expect(await checkPrivateKey('x'.repeat(9_000), 'RS256')).toMatch(/Paste the private key/)
  })
})
