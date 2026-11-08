import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string }
const productName = readFileSync('electron-builder.yml', 'utf8').match(/^productName: (.*)$/m)![1]

/** Path of the unpacked app that `pnpm build:unpack` produces for this OS. */
export function packagedExecutable(): string {
  const candidates =
    process.platform === 'win32'
      ? [`dist/win-unpacked/${pkg.name}.exe`]
      : process.platform === 'darwin'
        ? ['mac-arm64', 'mac'].map(
            (dir) => `dist/${dir}/${productName}.app/Contents/MacOS/${productName}`
          )
        : [`dist/linux-unpacked/${pkg.name}`]

  const found = candidates.find((c) => existsSync(c))
  if (!found) {
    throw new Error(
      `Packaged app not found (looked for ${candidates.join(', ')}). Run "pnpm build:unpack".`
    )
  }
  return found
}

export interface LaunchOptions {
  /** Contents of settings.json to start with. */
  settings?: object
  /** Reuse a user-data folder, to simulate starting the app a second time. */
  userData?: string
}

export function makeUserDataDir(): string {
  return mkdtempSync(join(tmpdir(), 'app-e2e-'))
}

/** Launch the packaged app with a throwaway user-data folder so tests never touch real settings. */
export async function launchApp(options: LaunchOptions = {}): Promise<ElectronApplication> {
  const userData = options.userData ?? makeUserDataDir()
  if (options.settings) {
    writeFileSync(join(userData, 'settings.json'), JSON.stringify(options.settings))
  }
  return electron.launch({
    executablePath: packagedExecutable(),
    // CI Linux runners cannot use Chromium's setuid sandbox.
    args: [`--user-data-dir=${userData}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])]
  })
}
