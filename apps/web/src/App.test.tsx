import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// The auth client talks to the network; replace it with a controllable fake.
const auth = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  pending: false,
  magicLink: vi.fn(),
  apiKey: { list: vi.fn(), create: vi.fn(), delete: vi.fn() },
  signInSso: vi.fn(),
  sso: {
    register: vi.fn(),
    verifyDomain: vi.fn(),
    providers: vi.fn(async () => ({ data: [], error: null })),
    requestDomainVerification: vi.fn(),
    deleteProvider: vi.fn()
  },
  organization: {
    list: vi.fn(),
    create: vi.fn(),
    getFullOrganization: vi.fn(),
    inviteMember: vi.fn(),
    cancelInvitation: vi.fn(),
    removeMember: vi.fn(),
    leave: vi.fn(),
    delete: vi.fn(),
    getInvitation: vi.fn(),
    acceptInvitation: vi.fn()
  },
  admin: {
    listUsers: vi.fn(),
    banUser: vi.fn(),
    unbanUser: vi.fn(),
    setRole: vi.fn(),
    impersonateUser: vi.fn(),
    stopImpersonating: vi.fn()
  },
  transfer: vi.fn(),
  ensureRedirect: vi.fn(() => 0),
  revoke: vi.fn(),
  signInPasskey: vi.fn(),
  listPasskeys: vi.fn(),
  addPasskey: vi.fn(),
  deletePasskey: vi.fn()
}))
vi.mock('./lib/auth', () => ({
  authClient: {
    useSession: () => ({ data: auth.session, isPending: auth.pending }),
    signIn: { magicLink: auth.magicLink, passkey: auth.signInPasskey, sso: auth.signInSso },
    passkey: {
      listUserPasskeys: auth.listPasskeys,
      addPasskey: auth.addPasskey,
      deletePasskey: auth.deletePasskey
    },
    signOut: vi.fn(),
    admin: auth.admin,
    apiKey: auth.apiKey,
    organization: auth.organization,
    sso: auth.sso,
    $fetch: auth.transfer,
    ensureElectronRedirect: auth.ensureRedirect,
    revokeSessions: auth.revoke
  }
}))
const accountApi = vi.hoisted(() => ({
  get: vi.fn(),
  export: vi.fn(),
  remove: vi.fn(),
  cancelDeletion: vi.fn(),
  cancelDeletionWithToken: vi.fn(),
  changeEmail: vi.fn(),
  signIns: vi.fn(),
  securityActivity: vi.fn(),
  privacy: vi.fn(),
  requests: vi.fn(),
  consents: vi.fn(),
  setConsent: vi.fn(),
  confirmEmailChange: vi.fn()
}))
const appConfigApi = vi.hoisted(() => vi.fn())
const turnstileProps = vi.hoisted(() => ({
  onToken: vi.fn() as (token: string | null) => void
}))
vi.mock('./components/Turnstile', () => ({
  Turnstile: (props: { onToken: (token: string | null) => void }) => {
    turnstileProps.onToken = props.onToken
    return <div data-testid="turnstile" />
  }
}))
const prefsApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
const feedbackApi = vi.hoisted(() => ({ send: vi.fn() }))
const devicesApi = vi.hoisted(() => ({ list: vi.fn(), rename: vi.fn(), signOut: vi.fn() }))
vi.mock('./lib/api', () => ({
  api: {
    appConfig: appConfigApi,
    account: accountApi,
    preferences: prefsApi,
    feedback: feedbackApi,
    devices: devicesApi
  }
}))

beforeEach(() => {
  auth.session = null
  auth.pending = false
  auth.magicLink.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.transfer.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.ensureRedirect.mockClear()
  auth.signInPasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.listPasskeys.mockReset().mockResolvedValue({ data: [], error: null })
  auth.apiKey.list.mockReset().mockResolvedValue({ data: { apiKeys: [] }, error: null })
  auth.apiKey.create.mockReset()
  auth.apiKey.delete.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.addPasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.deletePasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.revoke.mockReset().mockResolvedValue({ data: {}, error: null })
  accountApi.get.mockReset().mockResolvedValue({
    id: 'u1',
    email: 'ada@example.com',
    name: 'ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    deletionScheduledFor: null,
    pendingEmail: null
  })
  localStorage.clear()
  appConfigApi.mockReset().mockResolvedValue({ minimumVersion: null })
  prefsApi.get.mockReset().mockResolvedValue({
    preferences: { theme: 'system', accent: 'neutral' },
    updatedAt: 0
  })
  prefsApi.put.mockReset().mockImplementation((r: unknown) => Promise.resolve(r))
  devicesApi.list.mockReset().mockResolvedValue([
    {
      id: 'd1',
      label: 'Chrome on Windows',
      nickname: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-02T00:00:00.000Z',
      current: true
    },
    {
      id: 'd2',
      label: 'Desktop app on macOS',
      nickname: 'Work laptop',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-02T00:00:00.000Z',
      current: false
    }
  ])
  devicesApi.rename.mockReset().mockResolvedValue(undefined)
  devicesApi.signOut.mockReset().mockResolvedValue(undefined)
  feedbackApi.send.mockReset().mockResolvedValue({ id: 'f1' })
  accountApi.export.mockReset()
  accountApi.remove.mockReset().mockResolvedValue({ scheduledFor: '2026-12-01T00:00:00.000Z' })
  accountApi.cancelDeletion.mockReset().mockResolvedValue(undefined)
  accountApi.cancelDeletionWithToken.mockReset().mockResolvedValue(undefined)
  accountApi.securityActivity.mockReset().mockResolvedValue([
    {
      at: '2026-11-01T10:00:00Z',
      type: 'user_sign_in_failed',
      outcome: 'failure',
      label: 'Chrome on Windows',
      ipAddress: null
    }
  ])
  accountApi.signIns.mockReset().mockResolvedValue([
    {
      at: '2026-01-02T00:00:00.000Z',
      label: 'Safari on macOS',
      ipAddress: '1.2.3.4',
      newDevice: true
    },
    {
      at: '2026-01-01T00:00:00.000Z',
      label: 'Chrome on Windows',
      ipAddress: null,
      newDevice: false
    }
  ])
  accountApi.privacy.mockReset().mockResolvedValue({
    devices: 2,
    signIns: 5,
    passkeys: 1,
    feedback: 1,
    hasSyncedSettings: true
  })
  accountApi.consents.mockReset().mockResolvedValue({ current: {}, history: [] })
  accountApi.setConsent.mockReset()
  accountApi.requests.mockReset().mockResolvedValue([
    {
      kind: 'deletion',
      status: 'processing',
      receivedAt: '2026-11-01T00:00:00.000Z',
      dueAt: '2026-12-01T00:00:00.000Z',
      completedAt: null
    },
    {
      kind: 'export',
      status: 'done',
      receivedAt: '2026-10-01T00:00:00.000Z',
      dueAt: '2026-10-31T00:00:00.000Z',
      completedAt: '2026-10-01T00:00:00.000Z'
    }
  ])
  accountApi.changeEmail.mockReset().mockResolvedValue(undefined)
  accountApi.confirmEmailChange.mockReset().mockResolvedValue({ email: 'new@example.com' })
})

const at = (path: string): void => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('routes', () => {
  it('shows the home page', () => {
    at('/')
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    const downloads = screen.getAllByRole('link', { name: 'Download' })
    expect(downloads.every((l) => l.getAttribute('href') === '/download')).toBe(true)
  })

  it('sends signed-out visitors from /app (and nested paths) to the sign-in page', async () => {
    at('/app/anything/here')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the web app to a signed-in user', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/app')
    expect(await screen.findByRole('heading', { name: 'Web app' })).toBeInTheDocument()
    expect(screen.getByText('Signed in as ada@example.com')).toBeInTheDocument()
  })

  it('shows a not-found page for unknown routes', () => {
    at('/nope')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('offers installers from the latest release', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          tag_name: 'v1.0.0',
          html_url: 'https://github.com/o/r/releases/tag/v1.0.0',
          assets: [
            { name: 'app-setup.exe', browser_download_url: 'https://x/app-setup.exe', size: 1 }
          ]
        })
      })
    )
    at('/download')
    expect(await screen.findByText('Latest version: v1.0.0')).toBeInTheDocument()
    expect(screen.getAllByText('Not available yet')).toHaveLength(2)
    const installers = screen
      .getAllByRole('link')
      .filter((l) => l.getAttribute('href')?.endsWith('.exe'))
    expect(installers).toHaveLength(1)
  })

  it('lists releases and filters them by channel', async () => {
    const rel = (tag: string, prerelease: boolean): unknown => ({
      tag_name: tag,
      html_url: 'https://github.com/o/r/releases/tag/' + tag,
      assets: [],
      prerelease,
      published_at: '2026-01-01T00:00:00Z'
    })
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => [rel('v2', false), rel('v2-beta', true)] })
    )
    at('/releases')
    expect(await screen.findByRole('heading', { name: 'v2' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /v2-beta/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(screen.getByRole('heading', { name: /v2-beta/ })).toBeInTheDocument()
  })

  it('lists the sub-processors', async () => {
    at('/sub-processors')
    expect(await screen.findByRole('heading', { name: 'Sub-processors' })).toBeInTheDocument()
    for (const name of ['Cloudflare', 'Resend', 'GitHub']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
  })

  it('falls back to GitHub when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/download')
    expect(await screen.findByText(/Could not load the latest version/)).toBeInTheDocument()
  })
})

describe('sign-in page', () => {
  it('sends the email link back to the authorize step when an AI app is waiting', async () => {
    at(
      '/sign-in?client_id=https%3A%2F%2Fa.example%2Fc.json&scope=openid&state=s&sig=abc&exp=1&next=%2Fevil'
    )
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    const call = auth.magicLink.mock.calls[0]![0] as { callbackURL: string }
    expect(call.callbackURL.startsWith('/api/auth/oauth2/authorize?client_id=')).toBe(true)
    // The old signature is dropped (the server signs the request again) and nothing else leaks in.
    expect(call.callbackURL).not.toContain('sig=')
    expect(call.callbackURL).not.toContain('evil')
  })

  it('asks for a link and tells the user to check their email', async () => {
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), ' Ada@Example.com ')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'ada@example.com', callbackURL: '/app' })
    )
    expect(await screen.findByRole('heading', { name: 'Check your email' })).toBeInTheDocument()
  })

  it('does not call the server for an invalid email', async () => {
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), 'nope')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('valid email')
  })

  it('explains a rate limit', async () => {
    auth.magicLink.mockResolvedValue({ data: null, error: { status: 429 } })
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries')
  })

  it('explains a link that did not work', () => {
    at('/sign-in?error=link')
    expect(screen.getByRole('alert')).toHaveTextContent('did not work')
  })

  it('says when the account is suspended', () => {
    at('/sign-in?error=suspended')
    expect(screen.getByRole('alert')).toHaveTextContent('suspended')
  })

  it('skips the form when already signed in', () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/sign-in')
    expect(screen.getByRole('heading', { name: 'Web app' })).toBeInTheDocument()
  })
})

describe('sign-in challenge', () => {
  it('asks for the check first and sends its token with the request', async () => {
    appConfigApi.mockResolvedValue({ minimumVersion: null, turnstileSiteKey: 'site-key' })
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await screen.findByTestId('turnstile')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Complete the check')
    act(() => turnstileProps.onToken('tok-1'))
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: { headers: { 'x-captcha-response': 'tok-1' } }
      })
    )
  })
})

describe('signing in from the desktop app', () => {
  const desktopQuery = 'client_id=electron&code_challenge=chal&state=st'

  it('forwards the desktop parameters and ends on the page that opens the app', async () => {
    at(`/sign-in?${desktopQuery}`)
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackURL: '/auth/desktop',
        fetchOptions: { query: { client_id: 'electron', code_challenge: 'chal', state: 'st' } }
      })
    )
  })

  it('does not add the parameters to a normal sign-in', async () => {
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    expect(auth.magicLink.mock.calls[0]![0]).not.toHaveProperty('fetchOptions')
  })

  it('hands an existing web session to the desktop app', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign })
    at(`/sign-in?${desktopQuery}`)
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/auth/desktop'))
    expect(auth.transfer).toHaveBeenCalledWith(
      '/electron/transfer-user',
      expect.objectContaining({ method: 'POST' })
    )
  })

  it('the callback page waits for the one-time code, then opens the app', async () => {
    at('/auth/desktop')
    expect(
      await screen.findByRole('heading', { name: 'Opening the desktop app' })
    ).toBeInTheDocument()
    expect(auth.ensureRedirect).toHaveBeenCalled()
  })
})

describe('status page', () => {
  const release = (tag: string, prerelease: boolean, hoursAgo: number): unknown => ({
    tag_name: tag,
    html_url: 'https://github.com/o/r/releases/tag/' + tag,
    assets: [],
    prerelease,
    published_at: new Date(Date.now() - hoursAgo * 3_600_000).toISOString()
  })

  it('shows the newest stable and beta versions and the usual rollout stage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [release('v1.0.9-beta', true, 3), release('v1.0.8', false, 30)]
      })
    )
    appConfigApi.mockResolvedValue({ minimumVersion: '1.0.5' })
    at('/status')
    expect(await screen.findByText('v1.0.8')).toBeInTheDocument()
    expect(screen.getByText('v1.0.9-beta')).toBeInTheDocument()
    expect(screen.getByText(/about 25% of people/)).toBeInTheDocument()
    expect(screen.getByText(/older than 1.0.5 must be updated/)).toBeInTheDocument()
  })

  it('still works when the minimum version cannot be read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => [release('v1.0.8', false, 100)] })
    )
    appConfigApi.mockRejectedValue(new Error('down'))
    at('/status')
    expect(await screen.findByText('Offered to everyone.')).toBeInTheDocument()
    expect(screen.getByText(/No limit/)).toBeInTheDocument()
  })

  it('says so when the releases cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/status')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the releases')
  })
})

describe('privacy page', () => {
  it('shows what is stored, with counts', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account/privacy')
    expect(await screen.findByText(/2 places you are signed in/)).toBeInTheDocument()
    expect(screen.getByText(/5 sign-ins from the last 90 days/)).toBeInTheDocument()
    expect(screen.getByText(/1 message you sent us/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download my data' })).toBeInTheDocument()
    const requests = await screen.findByRole('region', { name: 'Your requests' })
    expect(within(requests).getByText('Account deletion')).toBeInTheDocument()
    expect(within(requests).getByText('In progress')).toBeInTheDocument()
    expect(within(requests).getByText('Data export')).toBeInTheDocument()
    expect(within(requests).getByText('Done')).toBeInTheDocument()
  })

  it('lets a person agree to something and shows it was saved', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    accountApi.setConsent.mockResolvedValue({
      current: { 'crash-reports': true },
      history: [
        {
          purpose: 'crash-reports',
          granted: true,
          policyVersion: 'v',
          at: new Date().toISOString()
        }
      ]
    })
    at('/account/privacy')
    const section = await screen.findByRole('region', { name: 'Your agreements' })
    await userEvent.click(within(section).getAllByRole('button', { name: 'Agree' })[1]!)
    expect(await within(section).findByRole('button', { name: 'Withdraw' })).toBeInTheDocument()
    expect(accountApi.setConsent).toHaveBeenCalledWith('crash-reports', true)
  })

  it('sends signed-out visitors to the sign-in page', () => {
    at('/account/privacy')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('sign-in activity', () => {
  it('lists recent sign-ins and marks a new device', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    const region = await screen.findByRole('region', { name: 'Recent sign-ins' })
    expect(await within(region).findByText('Safari on macOS')).toBeInTheDocument()
    expect(within(region).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(region).getByText('New')).toBeInTheDocument()
  })
})

describe('email change', () => {
  it('asks for the change from the account page', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await userEvent.type(await screen.findByLabelText('New email address'), 'New@Example.com')
    await userEvent.click(screen.getByRole('button', { name: 'Change email' }))
    await waitFor(() => expect(accountApi.changeEmail).toHaveBeenCalledWith('New@Example.com'))
    expect(
      await screen.findByText(/Check new@example.com for a confirmation link/)
    ).toBeInTheDocument()
  })

  it('confirms only when the button is pressed', async () => {
    at('/account/confirm-email?token=abc')
    expect(accountApi.confirmEmailChange).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm this address' }))
    await waitFor(() => expect(accountApi.confirmEmailChange).toHaveBeenCalledWith('abc'))
    expect(
      await screen.findByRole('heading', { name: 'Your email address was changed' })
    ).toBeInTheDocument()
  })

  it('says so when the link no longer works', async () => {
    accountApi.confirmEmailChange.mockRejectedValue(new Error('404'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/account/confirm-email?token=abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Confirm this address' }))
    expect(
      await screen.findByRole('heading', { name: 'This link does not work' })
    ).toBeInTheDocument()
  })
})

describe('cancel deletion page', () => {
  it('cancels only when the button is pressed', async () => {
    at('/account/cancel-deletion?token=abc')
    expect(accountApi.cancelDeletionWithToken).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Keep my account' }))
    await waitFor(() => expect(accountApi.cancelDeletionWithToken).toHaveBeenCalledWith('abc'))
    expect(await screen.findByRole('heading', { name: 'Your account is safe' })).toBeInTheDocument()
  })

  it('says so when the link no longer works', async () => {
    accountApi.cancelDeletionWithToken.mockRejectedValue(new Error('404'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/account/cancel-deletion?token=abc')
    await userEvent.click(await screen.findByRole('button', { name: 'Keep my account' }))
    expect(
      await screen.findByRole('heading', { name: 'This link does not work' })
    ).toBeInTheDocument()
  })

  it('has nothing to do without a token', async () => {
    at('/account/cancel-deletion')
    expect(
      await screen.findByRole('heading', { name: 'This link does not work' })
    ).toBeInTheDocument()
  })
})

describe('account page', () => {
  it('sends signed-out visitors to the sign-in page', () => {
    at('/account')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('only enables deleting once the email is typed exactly, then deletes', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    expect(await screen.findByText('Signed in as ada@example.com')).toBeInTheDocument()
    const button = screen.getByRole('button', { name: 'Delete my account' })
    expect(button).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Confirm your email'), 'ada@example.org')
    expect(button).toBeDisabled()
    await userEvent.clear(screen.getByLabelText('Confirm your email'))
    await userEvent.type(screen.getByLabelText('Confirm your email'), 'Ada@Example.com')
    expect(button).toBeEnabled()
    await userEvent.click(button)
    await waitFor(() => expect(accountApi.remove).toHaveBeenCalledWith('Ada@Example.com'))
    expect(await screen.findByText(/Your account will be deleted on/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete my account' })).not.toBeInTheDocument()
  })

  it('shows a scheduled deletion and lets you keep the account', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    accountApi.get.mockResolvedValue({
      id: 'u1',
      email: 'ada@example.com',
      name: 'ada',
      createdAt: '2026-01-01T00:00:00.000Z',
      deletionScheduledFor: '2026-12-01T00:00:00.000Z'
    })
    at('/account')
    await userEvent.click(await screen.findByRole('button', { name: 'Keep my account' }))
    await waitFor(() => expect(accountApi.cancelDeletion).toHaveBeenCalled())
    expect(await screen.findByRole('button', { name: 'Delete my account' })).toBeInTheDocument()
  })

  it('signs out everywhere', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out everywhere' }))
    await waitFor(() => expect(auth.revoke).toHaveBeenCalled())
  })

  it('shows an error when the data cannot be downloaded', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    accountApi.export.mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/account')
    await userEvent.click(await screen.findByRole('button', { name: 'Download my data' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not download your data.')
  })
})

describe('passkeys', () => {
  it('offers a passkey button on the sign-in page only when the browser supports passkeys', async () => {
    at('/sign-in')
    expect(screen.queryByRole('button', { name: 'Sign in with a passkey' })).toBeNull()
    vi.stubGlobal('PublicKeyCredential', class {})
    document.body.innerHTML = ''
    at('/sign-in')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))
    expect(auth.signInPasskey).toHaveBeenCalled()
  })

  it('lists, adds and removes passkeys on the account page', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    auth.listPasskeys.mockResolvedValue({ data: [{ id: 'p1', name: 'Laptop' }], error: null })
    at('/account')
    expect(await screen.findByText('Laptop')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add a passkey' }))
    await waitFor(() => expect(auth.addPasskey).toHaveBeenCalledWith({ name: 'Passkey 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove Laptop' }))
    await waitFor(() => expect(auth.deletePasskey).toHaveBeenCalledWith({ id: 'p1' }))
  })
})

describe('theme sync', () => {
  it('saves a chosen theme here and on the server', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
    await waitFor(() =>
      expect(prefsApi.put).toHaveBeenCalledWith(
        expect.objectContaining({ preferences: { theme: 'dark', accent: 'neutral' } })
      )
    )
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(await screen.findByRole('status')).toHaveTextContent('desktop app will use it too')
  })

  it('takes a newer theme from another device', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    prefsApi.get.mockResolvedValue({
      preferences: { theme: 'light', accent: 'neutral' },
      updatedAt: Date.now() + 1000
    })
    at('/account')
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Light' })).toBeChecked())
    expect(prefsApi.put).not.toHaveBeenCalled()
  })

  it('saves a chosen accent colour without resetting the theme', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
    await userEvent.click(await screen.findByRole('radio', { name: 'Accent blue' }))
    await waitFor(() =>
      expect(prefsApi.put).toHaveBeenLastCalledWith(
        expect.objectContaining({ preferences: { theme: 'dark', accent: 'blue' } })
      )
    )
    expect(document.documentElement.dataset.accent).toBe('blue')
    expect(screen.getByRole('radio', { name: 'Accent blue' })).toBeChecked()
  })

  it('keeps working when the server is down', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    prefsApi.put.mockRejectedValue(new Error('offline'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/account')
    await userEvent.click(await screen.findByRole('radio', { name: 'Dark' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Saved on this device')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})

describe('feedback page', () => {
  it('sends you to sign in first', async () => {
    at('/feedback')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('sends the message with its kind and thanks you', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/feedback')
    await userEvent.click(await screen.findByRole('radio', { name: 'An idea' }))
    await userEvent.type(screen.getByLabelText('Your message'), 'Please add a dark mode')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    await waitFor(() =>
      expect(feedbackApi.send).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'idea', message: 'Please add a dark mode', source: 'web' })
      )
    )
    expect(await screen.findByRole('status')).toHaveTextContent('Thank you')
  })

  it('shows why sending failed', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    feedbackApi.send.mockRejectedValue(new Error('You have sent a lot of feedback.'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/feedback')
    await userEvent.type(await screen.findByLabelText('Your message'), 'Something is wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Send feedback' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('a lot of feedback')
  })
})

describe('devices', () => {
  it('lists where you are signed in, and signs another one out', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    expect(await screen.findByText('Work laptop')).toBeInTheDocument()
    expect(screen.getByText('This device')).toBeInTheDocument()
    // Only the other device can be signed out from here.
    const buttons = within(screen.getByRole('region', { name: 'Your devices' })).getAllByRole(
      'button',
      { name: 'Sign out' }
    )
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0]!)
    await waitFor(() => expect(devicesApi.signOut).toHaveBeenCalledWith('d2'))
  })

  it('renames a device', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await screen.findByText('Work laptop')
    await userEvent.click(screen.getAllByRole('button', { name: 'Rename' })[0]!)
    await userEvent.type(screen.getByLabelText('Device name'), 'Home PC')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(devicesApi.rename).toHaveBeenCalledWith('d1', 'Home PC'))
  })
})

describe('a team sign-in page', () => {
  afterEach(() => vi.unstubAllGlobals())

  it("offers the company's login for a team that has one, and starts it with the team slug", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ name: 'Acme Corp' }))
    )
    auth.signInSso.mockReset().mockResolvedValue({ data: {}, error: null })
    at('/t/acme/sign-in')
    expect(await screen.findByRole('heading', { name: 'Sign in to Acme Corp' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continue with Acme Corp' }))
    expect(auth.signInSso).toHaveBeenCalledWith({ organizationSlug: 'acme', callbackURL: '/app' })
  })

  it('passes the address in the link on as a login hint', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ name: 'Acme Corp' }))
    )
    auth.signInSso.mockReset().mockResolvedValue({ data: {}, error: null })
    at('/t/acme/sign-in?login_hint=ada@acme.example')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue with Acme Corp' }))
    expect(auth.signInSso).toHaveBeenCalledWith({
      organizationSlug: 'acme',
      callbackURL: '/app',
      loginHint: 'ada@acme.example'
    })
  })

  it('sends a team without a company sign-in to the ordinary sign-in page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 }))
    )
    at('/t/nobody/sign-in')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})

describe('admin page', () => {
  const people = {
    data: {
      users: [
        { id: 'u1', email: 'me@example.com', role: 'admin', banned: false },
        { id: 'u2', email: 'them@example.com', role: 'user', banned: false }
      ],
      total: 2
    },
    error: null
  }

  it('sends people who are not staff away', () => {
    auth.session = { user: { email: 'a@b.co', id: 'u9', role: 'user' } } as never
    at('/admin')
    expect(auth.admin.listUsers).not.toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'People' })).not.toBeInTheDocument()
  })

  it('lets an admin list and suspend people, but not themselves', async () => {
    auth.session = { user: { email: 'me@example.com', id: 'u1', role: 'admin' } } as never
    auth.admin.listUsers.mockResolvedValue(people)
    auth.admin.banUser.mockResolvedValue({ data: {}, error: null })
    at('/admin')
    expect(await screen.findByText('them@example.com')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Suspend' })
    expect(buttons).toHaveLength(1)
    await userEvent.click(buttons[0]!)
    expect(auth.admin.banUser).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u2' }))
  })

  it("lets an admin change another person's role", async () => {
    auth.session = { user: { email: 'me@example.com', id: 'u1', role: 'admin' } } as never
    auth.admin.listUsers.mockResolvedValue(people)
    auth.admin.setRole.mockResolvedValue({ data: {}, error: null })
    at('/admin')
    await screen.findByText('them@example.com')
    await userEvent.selectOptions(screen.getByLabelText('Role of them@example.com'), 'support')
    expect(auth.admin.setRole).toHaveBeenCalledWith({ userId: 'u2', role: 'support' })
  })

  it('shows a banner with a stop button while helping someone', () => {
    auth.session = {
      user: { email: 'them@example.com', id: 'u2' },
      session: { impersonatedBy: 'u1' }
    } as never
    at('/account')
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument()
  })

  it('lets an admin switch an AI app off after confirming, and support does not see the list', async () => {
    const fetched: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        fetched.push({ url, init })
        if (url === '/api/admin/ai-apps')
          return Response.json([
            {
              clientId: 'https://assistant.example/client.json',
              name: 'Test Assistant',
              disabled: false,
              people: 2,
              createdAt: null
            }
          ])
        return Response.json({ ok: true })
      })
    )
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    auth.session = { user: { email: 'me@example.com', id: 'u1', role: 'admin' } } as never
    auth.admin.listUsers.mockResolvedValue(people)
    at('/admin')
    expect(await screen.findByText('Test Assistant')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Switch off' }))
    expect(window.confirm).toHaveBeenCalled()
    const post = fetched.find((f) => f.url === '/api/admin/ai-apps/disable')
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      clientId: 'https://assistant.example/client.json'
    })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows support the list without any buttons to change it', async () => {
    auth.session = { user: { email: 'help@example.com', id: 'u3', role: 'support' } } as never
    auth.admin.listUsers.mockResolvedValue(people)
    at('/admin')
    expect(await screen.findByText('them@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
  })
})

describe('API keys on the account page', () => {
  beforeEach(() => {
    auth.session = { user: { email: 'ada@example.com' } }
  })

  it('shows a new key once, and lists keys by name', async () => {
    auth.apiKey.create.mockResolvedValue({ data: { key: 'key_secret123' }, error: null })
    auth.apiKey.list.mockResolvedValue({
      data: { apiKeys: [{ id: 'k1', name: 'Backup', start: 'key_ab', expiresAt: null }] },
      error: null
    })
    at('/account')
    expect(await screen.findByText(/Backup/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Key name'), 'Deploy')
    await userEvent.click(screen.getByRole('button', { name: 'Make a key' }))
    expect(auth.apiKey.create).toHaveBeenCalledWith({ name: 'Deploy' })
    expect(await screen.findByText('key_secret123')).toBeInTheDocument()
  })

  it('deletes a key', async () => {
    auth.apiKey.list.mockResolvedValue({
      data: { apiKeys: [{ id: 'k1', name: 'Backup', start: 'key_ab', expiresAt: null }] },
      error: null
    })
    at('/account')
    await screen.findByText(/Backup/)
    const list = screen.getByRole('region', { name: 'API keys' })
    await userEvent.click(within(list).getByRole('button', { name: 'Delete' }))
    expect(auth.apiKey.delete).toHaveBeenCalledWith({ keyId: 'k1' })
  })
})

describe('security activity on the account page', () => {
  it('lists events with plain names and marks failures', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    const section = await screen.findByRole('region', { name: 'Security activity' })
    expect(await within(section).findByText('Sign-in failed')).toBeInTheDocument()
    expect(within(section).getByText('Failed')).toBeInTheDocument()
  })
})

describe('teams', () => {
  const team = {
    id: 't1',
    name: 'Acme',
    members: [
      { id: 'm1', userId: 'u1', role: 'owner', user: { email: 'me@example.com', name: 'Me' } },
      { id: 'm2', userId: 'u2', role: 'member', user: { email: 'mate@example.com', name: 'Mate' } }
    ],
    invitations: [{ id: 'i1', email: 'new@example.com', role: 'member', status: 'pending' }]
  }
  beforeEach(() => {
    auth.session = { user: { email: 'me@example.com', id: 'u1' } } as never
    auth.organization.list.mockResolvedValue({ data: [{ id: 't1', name: 'Acme' }], error: null })
    auth.organization.getFullOrganization.mockResolvedValue({ data: team, error: null })
    auth.organization.create.mockResolvedValue({ data: {}, error: null })
    auth.organization.inviteMember.mockResolvedValue({ data: {}, error: null })
    auth.organization.removeMember.mockResolvedValue({ data: {}, error: null })
  })

  it('creates a team', async () => {
    at('/teams')
    await screen.findByText('Acme')
    await userEvent.type(screen.getByLabelText('Team name'), 'Beta')
    await userEvent.click(screen.getByRole('button', { name: 'Create team' }))
    expect(auth.organization.create).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Beta', slug: expect.stringMatching(/^beta-/) })
    )
  })

  it('lets an owner invite and remove people', async () => {
    at('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    const section = await screen.findByRole('region', { name: 'Team Acme' })
    await userEvent.type(within(section).getByLabelText('Email to invite'), 'friend@example.com')
    await userEvent.click(within(section).getByRole('button', { name: 'Send invitation' }))
    expect(auth.organization.inviteMember).toHaveBeenCalledWith({
      email: 'friend@example.com',
      role: 'member',
      organizationId: 't1'
    })
    await userEvent.click(within(section).getByRole('button', { name: 'Remove' }))
    expect(auth.organization.removeMember).toHaveBeenCalledWith({
      memberIdOrEmail: 'm2',
      organizationId: 't1'
    })
  })

  it('shows a plain member no way to invite or remove', async () => {
    auth.session = { user: { email: 'mate@example.com', id: 'u2' } } as never
    at('/teams')
    await userEvent.click(await screen.findByRole('button', { name: 'Open' }))
    const section = await screen.findByRole('region', { name: 'Team Acme' })
    expect(within(section).queryByLabelText('Email to invite')).not.toBeInTheDocument()
    expect(within(section).queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(within(section).getByRole('button', { name: 'Leave team' })).toBeInTheDocument()
  })
})

describe('accepting an invitation', () => {
  it('asks a signed-out visitor to sign in and comes back afterwards', async () => {
    auth.session = null
    at('/accept-invitation/inv1')
    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the team and joins it', async () => {
    auth.session = { user: { email: 'guest@example.com', id: 'u5' } } as never
    auth.organization.getInvitation.mockResolvedValue({
      data: { organizationName: 'Acme' },
      error: null
    })
    auth.organization.acceptInvitation.mockResolvedValue({ data: {}, error: null })
    auth.organization.list.mockResolvedValue({ data: [], error: null })
    at('/accept-invitation/inv1')
    await userEvent.click(await screen.findByRole('button', { name: 'Accept invitation' }))
    expect(auth.organization.acceptInvitation).toHaveBeenCalledWith({ invitationId: 'inv1' })
  })

  it('sends a signed-in person on to the page they asked for, but only on this site', async () => {
    auth.session = { user: { email: 'a@b.co', id: 'u1' } } as never
    at('/sign-in?next=%2Fteams')
    expect(await screen.findByRole('heading', { name: 'Teams' })).toBeInTheDocument()
    at('/sign-in?next=%2F%2Fevil.example')
    expect(screen.queryByText('evil.example')).not.toBeInTheDocument()
  })
})

describe('company sign-in', () => {
  it('starts single sign-on with the work email', async () => {
    auth.session = null
    auth.signInSso.mockResolvedValue({ data: {}, error: null })
    at('/sign-in')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with your company' }))
    expect(auth.signInSso).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Email'), 'ada@acme.example')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with your company' }))
    // The typed address also goes along as a hint, so the company's login can fill it in.
    expect(auth.signInSso).toHaveBeenCalledWith({
      email: 'ada@acme.example',
      callbackURL: '/app',
      loginHint: 'ada@acme.example'
    })
  })

  it('explains when the company has no single sign-on', async () => {
    auth.session = null
    auth.signInSso.mockResolvedValue({ data: null, error: { status: 404 } })
    at('/sign-in')
    await userEvent.type(screen.getByLabelText('Email'), 'ada@nobody.example')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in with your company' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not set up single sign-on')
  })

  it('lets an admin add a provider and shows the DNS record to publish', async () => {
    auth.session = { user: { email: 'me@example.com', id: 'u1', role: 'admin' } } as never
    auth.admin.listUsers.mockResolvedValue({ data: { users: [], total: 0 }, error: null })
    auth.sso.register.mockResolvedValue({
      data: { domainVerificationToken: 'tok123' },
      error: null
    })
    auth.sso.verifyDomain.mockResolvedValue({ data: {}, error: null })
    const real = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) =>
      String(input).startsWith('/api/sso-discover')
        ? Response.json({
            issuer: 'https://idp.acme.example',
            authorizationEndpoint: 'https://idp.acme.example/authorize',
            tokenEndpoint: 'https://idp.acme.example/token',
            jwksEndpoint: 'https://idp.acme.example/keys',
            tokenEndpointAuthMethods: ['client_secret_basic']
          })
        : real(input, init)
    )
    at('/admin')
    await userEvent.type(await screen.findByLabelText('Provider name'), 'acme')
    await userEvent.type(screen.getByLabelText('Issuer URL'), 'https://idp.acme.example')
    await userEvent.type(screen.getByLabelText('Email domain'), 'Acme.Example')
    await userEvent.type(screen.getByLabelText('Client ID'), 'cid')
    await userEvent.type(screen.getByLabelText('Client secret'), 'shh')
    await userEvent.click(screen.getByRole('button', { name: 'Add provider' }))
    expect(auth.sso.register).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'acme',
        domain: 'acme.example',
        oidcConfig: expect.objectContaining({
          skipDiscovery: true,
          tokenEndpoint: 'https://idp.acme.example/token'
        })
      })
    )
    expect(await screen.findByText(/tok123/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check the record' }))
    expect(await screen.findByText(/Domain verified/)).toBeInTheDocument()
  })

  it('does not show provider setup to support staff', async () => {
    auth.session = { user: { email: 'help@example.com', id: 'u3', role: 'support' } } as never
    auth.admin.listUsers.mockResolvedValue({ data: { users: [], total: 0 }, error: null })
    at('/admin')
    await screen.findByRole('heading', { name: 'People' })
    expect(screen.queryByLabelText('Provider name')).not.toBeInTheDocument()
  })
})

describe('admin: one person activity', () => {
  it('loads and shows the activity of the chosen person', async () => {
    auth.session = { user: { email: 'me@example.com', id: 'u1', role: 'admin' } } as never
    auth.admin.listUsers.mockResolvedValue({
      data: {
        users: [{ id: 'u2', email: 'them@example.com', role: 'user', banned: false }],
        total: 1
      },
      error: null
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/api/admin/ai-apps'
          ? Response.json([])
          : Response.json([
              {
                at: '2026-11-01T10:00:00Z',
                type: 'user_sign_in_failed',
                outcome: 'failure',
                label: null,
                ipAddress: '1.2.3.4'
              }
            ])
      )
    )
    at('/admin')
    await userEvent.click(await screen.findByRole('button', { name: 'Activity' }))
    const section = await screen.findByRole('region', { name: 'Activity' })
    expect(await within(section).findByText(/user sign in failed/)).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledWith('/api/admin/audit/u2', expect.anything())
  })
})

describe('consent page (AI apps)', () => {
  it('names the app, lists what it can do and posts the answer with the signed request', async () => {
    auth.transfer.mockImplementation(async (path: string) =>
      path === '/oauth2/public-client'
        ? { data: { client_name: 'Test Assistant' }, error: null }
        : { data: {}, error: null }
    )
    at('/consent?client_id=https%3A%2F%2Fa.example%2Fc.json&scope=openid%20mcp%3Aread&sig=abc')
    expect(
      await screen.findByRole('heading', { name: 'Connect Test Assistant?' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Read your account/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(auth.transfer).toHaveBeenCalledWith(
        '/oauth2/consent',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            accept: false,
            oauth_query: expect.stringContaining('sig=abc')
          })
        })
      )
    )
  })

  it('refuses a visit that carries no signed request', () => {
    at('/consent')
    expect(screen.getByRole('heading', { name: 'This link does not work' })).toBeInTheDocument()
  })
})

describe('device page (AI apps without a browser)', () => {
  it('names the app and what it asks for before approving, then approves', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    auth.transfer.mockImplementation(async (path: string) => {
      if (path === '/device')
        return {
          data: {
            status: 'pending',
            client_id: 'https://a.example/c.json',
            scope: 'openid mcp:read'
          },
          error: null
        }
      if (path === '/oauth2/public-client')
        return { data: { client_name: 'Terminal Agent' }, error: null }
      return { data: {}, error: null }
    })
    at('/device?user_code=ABCD1234')
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }))
    expect(
      await screen.findByRole('heading', { name: 'Connect Terminal Agent?' })
    ).toBeInTheDocument()
    expect(screen.getByText(/Read your account/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Allow' }))
    await waitFor(() =>
      expect(auth.transfer).toHaveBeenCalledWith(
        '/device/approve',
        expect.objectContaining({ body: { userCode: 'ABCD1234' } })
      )
    )
    expect(await screen.findByRole('heading', { name: 'App connected' })).toBeInTheDocument()
  })

  it('sends a signed-out visitor to sign in first', async () => {
    at('/device?user_code=ABCD1234')
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })
})
