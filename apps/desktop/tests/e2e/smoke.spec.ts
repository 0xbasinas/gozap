import { expect, test } from '@playwright/test'
import type { Api } from '../../src/preload/api'
import { launchApp, makeUserDataDir } from './launch'

type WithApi = { api: Api }

test('packaged app opens and the renderer talks to main', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    // The window opened and React rendered (not just the splash).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Check for updates' })).toBeVisible()

    // Preload exposed the API (under the sandbox), and an IPC round trip through main works.
    const result = await page.evaluate(async () => {
      const api = (window as unknown as WithApi).api
      return { platform: api.platform, settings: await api.getSettings() }
    })
    expect(result.platform).toBe(process.platform)
    expect(result.settings).toEqual({
      theme: 'system',
      accent: 'neutral',
      updateChannel: 'latest',
      closeToTray: false,
      launchAtLogin: false,
      crashReports: false
    })

    // The UI is served from our own scheme, not file://.
    expect(page.url()).toMatch(/^app:\/\/renderer\//)

    // Node is not reachable from the renderer.
    expect(
      await page.evaluate(() => typeof (window as unknown as { require?: unknown }).require)
    ).toBe('undefined')

    // The native application menu is installed.
    const menus = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.items.map((item) => item.label)
    )
    expect(menus).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Help']))

    // The window has a real size and the app is the packaged one.
    const size = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getBounds()
    )
    expect(size.width).toBeGreaterThan(400)
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true)

    // The renderer really is sandboxed.
    const sandboxed = await page.evaluate(
      () => (window as unknown as { process?: unknown }).process
    )
    expect(sandboxed).toBeUndefined()

    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})

test('main rejects invalid settings from the renderer', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    const outcomes = await page.evaluate(async () => {
      const api = (window as unknown as WithApi).api
      const attempt = async (patch: unknown): Promise<string> => {
        try {
          await api.updateSettings(patch as never)
          return 'accepted'
        } catch {
          return 'rejected'
        }
      }
      return [
        await attempt({ updateChannel: 'nightly' }),
        await attempt({ closeToTray: 'yes' }),
        await attempt({ theme: 'pink' }),
        await attempt({ isAdmin: true }),
        await attempt('latest')
      ]
    })
    expect(outcomes).toEqual(['rejected', 'rejected', 'rejected', 'rejected', 'rejected'])
  } finally {
    await app.close()
  }
})

test('the theme setting changes the colours the page sees', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Playwright pins pages to a light colour scheme; let the app's own theme decide.
    await page.emulateMedia({ colorScheme: null })
    const dark = (): Promise<boolean> =>
      page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)

    await page.evaluate(() => (window as unknown as WithApi).api.updateSettings({ theme: 'dark' }))
    await expect.poll(dark).toBe(true)
    await expect(page.locator('html')).toHaveClass(/dark/)
    await page.evaluate(() => (window as unknown as WithApi).api.updateSettings({ theme: 'light' }))
    await expect.poll(dark).toBe(false)
    await expect(page.locator('html')).not.toHaveClass(/dark/)
  } finally {
    await app.close()
  }
})

test('the accent setting recolours the page', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const html = page.locator('html')
    await expect(html).toHaveAttribute('data-accent', 'neutral')
    await page.evaluate(() => (window as unknown as WithApi).api.updateSettings({ accent: 'blue' }))
    await expect(html).toHaveAttribute('data-accent', 'blue')
    // The renderer is untrusted: a made-up accent is refused by main.
    const refused = await page.evaluate(async () => {
      try {
        await (window as unknown as WithApi).api.updateSettings({ accent: 'url(x)' } as never)
        return false
      } catch {
        return true
      }
    })
    expect(refused).toBe(true)
    await expect(html).toHaveAttribute('data-accent', 'blue')
  } finally {
    await app.close()
  }
})

test('first run shows a welcome screen once, then not again', async () => {
  const userData = makeUserDataDir()

  const first = await launchApp({ userData })
  try {
    const page = await first.firstWindow()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/^Welcome to/)).toBeVisible()
    await dialog.getByRole('button', { name: 'Get started' }).click()
    await expect(dialog).toBeHidden()
  } finally {
    await first.close()
  }

  const second = await launchApp({ userData })
  try {
    const page = await second.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // Give the check time to finish, then confirm nothing opened.
    await page.waitForTimeout(500)
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // It can still be opened on purpose.
    await page.getByRole('button', { name: "What's new" }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
  } finally {
    await second.close()
  }
})

test('the settings window changes the update channel', async () => {
  const app = await launchApp()
  try {
    const page = await app.firstWindow()
    await page.getByRole('dialog').getByRole('button', { name: 'Get started' }).click()

    const [settingsPage] = await Promise.all([
      app.waitForEvent('window'),
      page.getByRole('button', { name: 'Settings' }).click()
    ])
    await settingsPage.waitForLoadState()

    const group = settingsPage.getByRole('radiogroup', { name: 'Update channel' })
    await expect(group).toBeVisible()
    await group.getByRole('radio', { name: /Beta/ }).click()

    await expect
      .poll(() =>
        page.evaluate(
          async () => (await (window as unknown as WithApi).api.getSettings()).updateChannel
        )
      )
      .toBe('beta')
  } finally {
    await app.close()
  }
})

test('closing the window hides it to the tray when that setting is on', async () => {
  test.skip(process.platform === 'darwin', 'macOS keeps the app alive on its own')
  const app = await launchApp({ settings: { closeToTray: true } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())

    // The window is hidden, not destroyed, and the app is still running.
    const state = await app.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows()
      return { count: windows.length, visible: windows[0]?.isVisible() }
    })
    expect(state).toEqual({ count: 1, visible: false })
  } finally {
    await app.close()
  }
})
