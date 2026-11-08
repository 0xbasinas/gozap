import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, createReadStream, existsSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import type { Api } from '../../src/preload/api'
import { withRollout } from '../../scripts/lib/rollout.mjs'

interface Build {
  port: number
  oldVersion: string
  newVersion: string
  oldExecutable: string
  oldAppImage: string | null
  feedDir: string
}

const build = JSON.parse(readFileSync('dist-update/build.json', 'utf8')) as Build
const pkgName = (JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }).name
const manifestName = process.platform === 'win32' ? 'latest.yml' : 'latest-linux.yml'

let server: Server
let rollout = 100

test.skip(process.platform === 'darwin', 'macOS updates need signed builds')

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const name = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(
      /^[\\/]+/,
      ''
    )
    const root = resolve(build.feedDir)
    const file = resolve(root, name)
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end()
      return
    }
    // The manifest is rewritten on the fly so one build can play both "everyone" and "not yet".
    if (name === manifestName) {
      res.writeHead(200, { 'content-type': 'text/yaml' })
      res.end(withRollout(readFileSync(file, 'utf8'), rollout))
      return
    }
    res.writeHead(200, {
      'content-type': extname(name) ? 'application/octet-stream' : 'text/plain'
    })
    createReadStream(file).pipe(res)
  })
  await new Promise<void>((resolve) => server.listen(build.port, '127.0.0.1', resolve))
})

test.afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

/** Updates are cached outside the app folder; start each test without a previous download. */
function clearUpdaterCache(): void {
  const base =
    process.platform === 'win32'
      ? (process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'))
      : (process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'))
  rmSync(join(base, `${pkgName}-updater`), { recursive: true, force: true })
}

async function launchOld(): Promise<ElectronApplication> {
  clearUpdaterCache()
  const userData = mkdtempSync(join(tmpdir(), 'app-update-'))
  return electron.launch({
    executablePath: build.oldExecutable,
    args: [
      `--user-data-dir=${userData}`,
      ...(process.platform === 'linux' ? ['--no-sandbox'] : [])
    ],
    // electron-updater needs this to treat a Linux build as an AppImage.
    env: {
      ...(process.env as Record<string, string>),
      ...(build.oldAppImage ? { APPIMAGE: join(process.cwd(), build.oldAppImage) } : {})
    }
  })
}

type Status = { type: string; version?: string; message?: string } | undefined

async function waitForStatus(page: Page, wanted: string): Promise<Status> {
  let status: Status
  await expect
    .poll(
      async () => {
        status = await page.evaluate(() =>
          (window as unknown as { api: Api }).api.getUpdaterStatus()
        )
        if (status?.type === 'error') throw new Error(`Updater failed: ${status.message}`)
        return status?.type
      },
      { timeout: 90_000, intervals: [500] }
    )
    .toBe(wanted)
  return status
}

test('an old build finds and downloads the new one', async () => {
  rollout = 100
  const app = await launchOld()
  try {
    const page = await app.firstWindow()
    expect(await app.evaluate(({ app: a }) => a.getVersion())).toBe(build.oldVersion)

    const status = await waitForStatus(page, 'downloaded')
    expect(status?.version).toBe(build.newVersion)

    // The user is told, and offered the restart.
    await expect(page.getByText(`Version ${build.newVersion} is ready to install.`)).toBeVisible()
  } finally {
    await app.close()
  }
})

test('a release that is staged at 0% is not offered', async () => {
  rollout = 0
  const app = await launchOld()
  try {
    const page = await app.firstWindow()
    const status = await waitForStatus(page, 'not-available')
    expect(status?.type).toBe('not-available')
  } finally {
    await app.close()
    rollout = 100
  }
})
