# Architecture

An Electron app runs three kinds of code. Knowing which one you are writing is most of the battle.

```
┌──────────────────────────── Main process (src/main) ────────────────────────────┐
│ Node.js with full OS access: windows, files, auto-update, deep links, settings. │
└───────────────▲──────────────────────────────────────────────┬──────────────────┘
                │ ipcMain.handle / webContents.send            │
        ┌───────┴──────────────── Preload (src/preload) ───────▼──────┐
        │ Runs before the page loads. Exposes a small, typed `window.api`. │
        └───────▲──────────────────────────────────────────────┬──────┘
                │ ipcRenderer.invoke / on                      │
┌───────────────┴───────────── Renderer (src/renderer) ────────▼──────────────────┐
│ A sandboxed web page (React). No Node access. Talks to main only via window.api. │
└──────────────────────────────────────────────────────────────────────────────────┘
```

Shared types and channel names live in `apps/desktop/src/shared/ipc.ts`, which all three import.

## Folders

| Path                                                            | What lives there                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/desktop/src/main/index.ts`                                | App startup, the window (custom title bar, no white flash), single-instance lock                     |
| `apps/desktop/src/main/updater.ts`                              | `electron-updater`: stable vs beta channel, differential downloads, update events                    |
| `apps/desktop/src/main/deeplink.ts`                             | `myapp://` links and file associations, on macOS, Windows and Linux                                  |
| `apps/desktop/src/main/menu.ts`                                 | The application menu (File, Edit, View, Window, Help) and its keyboard accelerators                  |
| `apps/desktop/src/main/tray.ts`                                 | System tray icon and menu, plus the optional "keep running when closed" setting                      |
| `apps/desktop/src/main/shortcuts.ts`                            | The global show/hide shortcut                                                                        |
| `apps/desktop/src/main/windowUtils.ts`                          | `showWindow`, `toggleWindow` and `requestUpdateCheck`, shared by menu, tray, shortcut and deep links |
| `apps/desktop/src/main/windowState.ts`                          | Remembers window size, position and maximized state between launches                                 |
| `apps/desktop/src/main/settings.ts`                             | Tiny JSON settings file in the user data folder                                                      |
| `apps/desktop/src/main/secureIpc.ts`                            | `handle()`: `ipcMain.handle` that rejects calls not coming from our own page                         |
| `apps/desktop/src/main/trust.ts`                                | `isTrustedUrl()`: which page URLs may talk to main                                                   |
| `apps/desktop/src/main/windowChrome.ts`                         | Shared window options (sandbox, title bar), `hardenWindow`, `loadRenderer`                           |
| `apps/desktop/src/main/ipcHandlers.ts`                          | Handlers for settings, app info, logs and what's new                                                 |
| `apps/desktop/src/main/settingsWindow.ts`, `settingsEffects.ts` | The Settings window, and what changing a setting does                                                |
| `apps/desktop/src/main/logger.ts`                               | `electron-log`: log file, rotation, uncaught errors, "Show Log File"                                 |
| `apps/desktop/src/main/whatsNew.ts`                             | Release notes and first-run state                                                                    |
| `apps/desktop/src/shared/validate.ts`                           | Checks for payloads coming from the renderer                                                         |
| `apps/desktop/src/preload/api.ts`                               | The `window.api` surface. Everything the page can ask main to do is listed here                      |
| `apps/desktop/src/preload/index.ts`                             | Exposes `api` with `contextBridge`                                                                   |
| `apps/desktop/src/shared/ipc.ts`                                | Channel names and payload types                                                                      |
| `apps/desktop/src/renderer/`                                    | The React app, Tailwind and shadcn/ui                                                                |
| `apps/desktop/build/`                                           | App icons (generated) and macOS entitlements                                                         |
| `apps/desktop/scripts/`                                         | Rename, icon generation and bundle-size scripts                                                      |

## How IPC flows

There are two directions, and both go through the preload script.

**Renderer asks, main answers** (request/response):

```
Toggle click → window.api.updateSettings({ updateChannel: 'beta' })
  → preload: ipcRenderer.invoke(IPC.settingsUpdate, patch)
  → main:    handle(IPC.settingsUpdate, ...) checks the sender, validates the patch, saves it,
             and settingsEffects re-checks for updates and tells every window
  → the returned Settings object resolves the promise in the renderer
```

**Main pushes, renderer listens** (events):

```
autoUpdater 'download-progress'
  → main:     webContents.send(IPC.updaterEvent, { type: 'progress', percent })
  → preload:  window.api.onUpdaterEvent(cb) subscribed with ipcRenderer.on
  → renderer: React state updates and the UI shows the percentage
```

Deep links and opened files use the same push pattern. If a link arrives before the window has
finished loading, `deeplink.ts` queues it and delivers it on `did-finish-load`.

## Adding a new IPC call

1. Add the channel name (and any payload type) to `apps/desktop/src/shared/ipc.ts`.
2. Handle it in main with `handle(IPC.yourChannel, ...)` from `secureIpc.ts` (not `ipcMain.handle`), and
   validate every argument with a function in `apps/desktop/src/shared/validate.ts`. Treat the renderer as untrusted.
3. Expose a typed function in `apps/desktop/src/preload/api.ts`.
4. Call `window.api.yourFunction()` from the renderer. The types flow through automatically.

Keep the preload surface small and specific. Expose "do this one thing" functions, never raw
`ipcRenderer` or file-system access.

## Window and title bar

The window uses `titleBarStyle: 'hidden'`, so the renderer draws the bar (`TitleBar.tsx`) and the OS
still draws the window controls: traffic lights on macOS, an overlay on Windows and Linux. The
bar is a drag region (`.app-drag`); interactive children are excluded automatically. The window
background color matches the theme, and `index.html` has an inline splash, so there is no white flash
while React starts.

## Deep links and file associations

- Scheme: `PROTOCOL` in `apps/desktop/src/main/deeplink.ts`, mirrored under `protocols` in `apps/desktop/electron-builder.yml`.
- File types: `FILE_EXTENSIONS` in `deeplink.ts`, mirrored under `fileAssociations`.
- Only one instance runs. Windows and Linux deliver links in `argv` (via `second-instance`), macOS
  uses `open-url` and `open-file`.
- Try it on a packaged build: open `electron-desktop-template://hello` from a browser or run it from a terminal.
  Protocol registration for a dev build (`pnpm dev`) works on Windows and Linux but is flaky on macOS.

## Menu, tray and shortcuts

- **Menu** (`menu.ts`): standard roles for Edit, View and Window, plus _Open File..._ (`Ctrl/Cmd+O`) and Help links.
  Reload and DevTools only exist in development. On Windows and Linux the bar is hidden by the custom title
  bar, but the accelerators still work.
- **Tray** (`tray.ts`): click to show or hide the window; the right-click menu has Show, Check for Updates, the
  _Keep running in the tray when closed_ option (stored as `closeToTray` in the settings file) and Quit.
  It also has What's New, Show Log File, Copy Diagnostics and (while signed in) Sign Out.
  If the desktop has no tray, creating it fails quietly and the app carries on without one.
- **Shortcut** (`shortcuts.ts`): `Ctrl/Cmd+Shift+Space` shows or hides the window from anywhere.
  Change `TOGGLE_WINDOW_SHORTCUT` to use another one. If another app already owns it, a warning is logged.
- "Check for Updates" in the menu or tray goes through the renderer (`menu:check-updates`), so you see the
  result in the update banner like a normal check.

## Security model

- Windows use `sandbox: true`, `contextIsolation: true` and `nodeIntegration: false`. A sandboxed preload can
  only import `electron` and bundled code, which is why `apps/desktop/src/preload` imports nothing else.
- `handle()` only answers the main frame of a page loaded from our own bundle (or the dev server in
  development). Anything else, such as an iframe or a navigated-away page, is rejected.
- **Electron fuses** are set in `apps/desktop/electron-builder.yml` (`electronFuses`) and written into the executable before signing:
  `runAsNode` and `NODE_OPTIONS` are off (so the app cannot be hijacked to run arbitrary Node code), cookies are encrypted,
  and the Node inspector flags are off in releases. **ASAR integrity** is on with `onlyLoadAppFromAsar`: the app refuses to
  start if `app.asar` was modified (it exits with "Integrity check failed for asar archive"). `grantFileProtocolExtraPrivileges`
  is off because the UI is not loaded from `file://` (see "The app:// scheme" below).
  `apps/desktop/scripts/lib/fuses.mjs` lists the expected state and CI checks it on the packaged app.
- The packaged UI is served from `app://renderer/`, and `isTrustedUrl` accepts only that origin (or the dev server).
- Payloads are validated in main (`parseSettingsPatch`), never trusted because the TypeScript type says so.
- New windows and navigations are blocked by `hardenWindow`; only `http(s)` links open in the browser.
- The page has a Content-Security-Policy in `index.html`.

## Settings window

The Settings window is the same renderer bundle loaded with the `#settings` hash (`main.tsx` picks
`SettingsWindow` instead of `App`), so it shares the theme, components and preload. It holds the update
channel, tray and launch-at-login options, update check, log file and what's new. Changes go through
`settings:update`, and `settingsEffects.ts` applies them (tray menu, channel re-check, login item) and
broadcasts `settings:changed` so every window and the tray stay in sync.

## Diagnostics, notifications, command palette and sync status

- **Diagnostics** (`diagnostics.ts` collects, `shared/diagnostics.ts` formats and is tested): `app:diagnostics` returns a text report
  (versions, GPU, memory, settings, the end of the log). It holds no account details and shows the home folder as `~`.
  Settings shows it with a copy button; the tray copies it straight to the clipboard.
- **Notifications** (`notify.ts`): the `notifications` setting (on by default) lets `notify()` show a native notification, for
  example when an update has downloaded. Quiet hours are not built yet.
- **Command palette** (`CommandPalette.tsx`, filter logic in `commandFilter.ts`): `Ctrl/Cmd+K` in the main window. Add an action by
  adding an entry to the `commands` list in `App.tsx`.
- **Sync status** (`preferencesSync.ts`, text from `shared/syncStatus.ts`): the account section of Settings says whether the theme
  and accent are synced, offline or signed out, and offers a retry. Channels: `sync:status`, `sync:retry`, event `sync:changed`.
- **Theme switch**: the page applies the chosen theme itself the moment the setting changes (`switchThemeInstantly` in `@repo/ui`
  holds transitions back for that frame), and `syncWindowColors` recolours the window, so there is no flash.

## Logging

`logger.ts` sets up `electron-log`: logs go to a file (2 MB, rotated), `console.*` in main is routed to it,
uncaught errors and renderer crashes are written there, and the updater logs through it. Help > Show Log File
reveals it. Nothing is sent anywhere; point `log.transports.remote` at a server if you want that.

## First run and what's new

`whatsNew.ts` compares the stored `lastSeenVersion` with the running version. No stored version means first
run (welcome); a different one means the app was updated (release notes); the same one shows nothing. Closing
the dialog marks the version as seen.

## The app:// scheme

In production the window loads `app://renderer/index.html`, not a `file://` URL. `apps/desktop/src/main/appProtocol.ts` registers the
scheme (before the app is ready; `standard` and `secure`, so it behaves like https for modules, storage and CORS) and
answers each request by reading the file from the built renderer folder inside `app.asar`. `resolveAppFile` in `appPath.ts`
maps the URL to a file and refuses anything that would leave that folder (`..`, encoded dots, sibling folders, NUL bytes);
it is unit tested. `isTrustedUrl` accepts only `app://renderer/` (or the dev server in development), so `secureIpc` rejects
every other page. This is what lets the `grantFileProtocolExtraPrivileges` fuse stay off. If you add a new asset type, add
its extension to the table in `appPath.ts`. The deep-link scheme (`PROTOCOL` in `deeplink.ts`) is a different thing.

## Account sign-in (browser, then back through the deep link)

Optional; only builds that know the API address (`API_URL`, baked in as `__API_URL__`) show it.

1. Settings > Account > **Sign in** calls `window.api.signIn()`, which reaches main (`src/main/auth.ts`) and `requestAuth()`. It opens the
   system browser on `<API>/sign-in` with a PKCE challenge and a random `state`. The sign-in page and its cookies never live inside Electron.
2. The person enters their email and opens the emailed magic link in the browser.
3. The site opens `<scheme>:/auth/callback#token=<one-time code>`. `deeplink.ts` routes it to `handleAuthCallback` in main, which first
   checks it with `authLink.ts` (scheme, path, characters and length of the code).
4. Main swaps the code and its secret verifier (which never left the process) for a session. The session is stored encrypted
   with the OS keychain (`safeStorage`). `account:changed` tells the windows.

The renderer only has `getAccount`, `signIn` and `signOut`; it never sees tokens. We use the client half of `@better-auth/electron`
only, not its `setupMain`, which would replace this app's scheme registration, CSP, single-instance lock and IPC.
