import { app, type BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { resolve } from 'path'
import { IPC } from '../shared/ipc'
import { handleAuthCallback, isAuthCallback } from './auth'
import { showWindow } from './windowUtils'

// URL scheme for deep links, e.g. electron-desktop-template://open/42
// Keep in sync with `protocols` in electron-builder.yml (`pnpm rename` does this for you).
export const PROTOCOL = 'electron-desktop-template'

// File types the app opens, e.g. double-clicking notes.tpl. Keep in sync with `fileAssociations`.
const FILE_EXTENSIONS = ['.tpl']

type Pending = { channel: string; payload: string }

let getWindow: () => BrowserWindow | undefined = () => undefined
const pending: Pending[] = []

function dispatch(channel: string, payload: string): void {
  const win = getWindow()
  if (!win || win.webContents.isLoading()) {
    pending.push({ channel, payload })
    return
  }
  showWindow(win)
  win.webContents.send(channel, payload)
}

/** Deliver anything that arrived before the window finished loading. Call after the page loads. */
export function flushPending(): void {
  const queued = pending.splice(0)
  queued.forEach(({ channel, payload }) => dispatch(channel, payload))
}

/** A deep link: the sign-in callback is handled here in main; everything else goes to the page. */
function route(url: string): void {
  if (isAuthCallback(url)) {
    const win = getWindow()
    if (win) showWindow(win)
    void handleAuthCallback(url)
    return
  }
  dispatch(IPC.deepLink, url)
}

function handleArgv(argv: string[]): void {
  for (const arg of argv) {
    if (arg.startsWith(`${PROTOCOL}:`)) {
      route(arg)
    } else if (FILE_EXTENSIONS.some((ext) => arg.toLowerCase().endsWith(ext)) && existsSync(arg)) {
      dispatch(IPC.openFile, resolve(arg))
    }
  }
}

/** Call once, before `app.whenReady()`, so macOS events that fire during startup aren't lost. */
export function initDeepLinks(windowGetter: () => BrowserWindow | undefined): void {
  getWindow = windowGetter

  if (process.defaultApp && process.argv[1]) {
    // `pnpm dev` runs through the electron binary, so it needs the script path too.
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  // macOS
  app.on('open-url', (event, url) => {
    event.preventDefault()
    route(url)
  })
  app.on('open-file', (event, path) => {
    event.preventDefault()
    dispatch(IPC.openFile, path)
  })

  // Windows and Linux: a second launch passes the link or file in argv.
  app.on('second-instance', (_event, argv) => {
    const win = getWindow()
    if (win) showWindow(win)
    handleArgv(argv)
  })

  // Windows and Linux: the first launch.
  handleArgv(process.argv)
}
