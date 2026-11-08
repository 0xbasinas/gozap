import { useState, type FormEvent, type JSX } from 'react'
import { Button } from '@repo/ui'
import { authClient } from '../lib/auth'

interface Registered {
  providerId: string
  domain: string
  token: string
}

/** Admins only: set up a company's OpenID Connect sign-in, then prove its domain with a DNS record. */
export function SsoAdminSection(): JSX.Element {
  const [providerId, setProviderId] = useState('')
  const [issuer, setIssuer] = useState('')
  const [domain, setDomain] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [done, setDone] = useState<Registered | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function register(event: FormEvent): Promise<void> {
    event.preventDefault()
    setMessage(null)
    const { data, error } = await authClient.sso.register({
      providerId: providerId.trim(),
      issuer: issuer.trim(),
      domain: domain.trim().toLowerCase(),
      oidcConfig: {
        clientId: clientId.trim(),
        clientSecret,
        scopes: ['openid', 'email', 'profile']
      }
    })
    if (error || !data) {
      setMessage(error?.message ?? 'Could not add the provider.')
      return
    }
    setClientSecret('')
    setDone({
      providerId: providerId.trim(),
      domain: domain.trim().toLowerCase(),
      token: (data as { domainVerificationToken?: string }).domainVerificationToken ?? ''
    })
  }

  async function verify(): Promise<void> {
    if (!done) return
    const { error } = await authClient.sso.verifyDomain({ providerId: done.providerId })
    setMessage(
      error
        ? 'The DNS record was not found yet. It can take a while to appear; try again later.'
        : 'Domain verified. People at this company can now sign in.'
    )
  }

  return (
    <section className="space-y-3" aria-label="Company sign-in">
      <h2 className="text-lg font-semibold">Company sign-in (OpenID Connect)</h2>
      <form onSubmit={(e) => void register(e)} className="grid max-w-md gap-2">
        {(
          [
            ['Provider name', providerId, setProviderId],
            ['Issuer URL', issuer, setIssuer],
            ['Email domain', domain, setDomain],
            ['Client ID', clientId, setClientId]
          ] as const
        ).map(([label, value, set]) => (
          <input
            key={label}
            aria-label={label}
            placeholder={label}
            value={value}
            onChange={(e) => set(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          />
        ))}
        <input
          aria-label="Client secret"
          placeholder="Client secret"
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        />
        <Button type="submit" variant="outline">
          Add provider
        </Button>
      </form>
      {done && (
        <div role="status" className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p>
            Add this DNS TXT record to prove {done.domain} belongs to them:
            <br />
            <code className="break-all">
              _better-auth-token-{done.providerId}.{done.domain} = {done.token}
            </code>
          </p>
          <Button variant="outline" size="sm" onClick={() => void verify()}>
            Check the record
          </Button>
        </div>
      )}
      {message && (
        <p role="alert" className="text-sm">
          {message}
        </p>
      )}
    </section>
  )
}
