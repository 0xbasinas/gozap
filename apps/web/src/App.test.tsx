import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

// The auth client talks to the network; replace it with a controllable fake.
const auth = vi.hoisted(() => ({
  session: null as null | { user: { email: string } },
  pending: false,
  magicLink: vi.fn(),
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
    signIn: { magicLink: auth.magicLink, passkey: auth.signInPasskey },
    passkey: {
      listUserPasskeys: auth.listPasskeys,
      addPasskey: auth.addPasskey,
      deletePasskey: auth.deletePasskey
    },
    signOut: vi.fn(),
    $fetch: auth.transfer,
    ensureElectronRedirect: auth.ensureRedirect,
    revokeSessions: auth.revoke
  }
}))
const accountApi = vi.hoisted(() => ({ get: vi.fn(), export: vi.fn(), remove: vi.fn() }))
const prefsApi = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }))
vi.mock('./lib/api', () => ({
  api: { account: accountApi, preferences: prefsApi }
}))

beforeEach(() => {
  auth.session = null
  auth.pending = false
  auth.magicLink.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.transfer.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.ensureRedirect.mockClear()
  auth.signInPasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.listPasskeys.mockReset().mockResolvedValue({ data: [], error: null })
  auth.addPasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.deletePasskey.mockReset().mockResolvedValue({ data: {}, error: null })
  auth.revoke.mockReset().mockResolvedValue({ data: {}, error: null })
  accountApi.get.mockReset().mockResolvedValue({
    id: 'u1',
    email: 'ada@example.com',
    name: 'ada',
    createdAt: '2026-01-01T00:00:00.000Z'
  })
  localStorage.clear()
  prefsApi.get.mockReset().mockResolvedValue({
    preferences: { theme: 'system', accent: 'neutral' },
    updatedAt: 0
  })
  prefsApi.put.mockReset().mockImplementation((r: unknown) => Promise.resolve(r))
  accountApi.export.mockReset()
  accountApi.remove.mockReset().mockResolvedValue(undefined)
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

  it('sends signed-out visitors from /app (and nested paths) to the sign-in page', () => {
    at('/app/anything/here')
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
  })

  it('shows the web app to a signed-in user', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/app')
    expect(screen.getByRole('heading', { name: 'Web app' })).toBeInTheDocument()
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

  it('falls back to GitHub when the lookup fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    at('/download')
    expect(await screen.findByText(/Could not load the latest version/)).toBeInTheDocument()
  })
})

describe('sign-in page', () => {
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

  it('skips the form when already signed in', () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/sign-in')
    expect(screen.getByRole('heading', { name: 'Web app' })).toBeInTheDocument()
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

  it('the callback page waits for the one-time code, then opens the app', () => {
    at('/auth/desktop')
    expect(screen.getByRole('heading', { name: 'Opening the desktop app' })).toBeInTheDocument()
    expect(auth.ensureRedirect).toHaveBeenCalled()
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
    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark')
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
    await waitFor(() => expect(screen.getByLabelText('Theme')).toHaveValue('light'))
    expect(prefsApi.put).not.toHaveBeenCalled()
  })

  it('saves a chosen accent colour without resetting the theme', async () => {
    auth.session = { user: { email: 'ada@example.com' } }
    at('/account')
    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark')
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
    await userEvent.selectOptions(await screen.findByLabelText('Theme'), 'dark')
    expect(await screen.findByRole('status')).toHaveTextContent('Saved on this device')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
