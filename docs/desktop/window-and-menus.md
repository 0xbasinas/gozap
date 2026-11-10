# Window, menus and links

How the window looks and behaves, and how the app is opened from a link, a file, the menu, the tray or a shortcut. Back to the [architecture overview](./architecture.md).

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
  When you are signed in and belong to at least one team, it also has a **Workspace** list (Personal and your teams, the
  active one ticked). Picking one switches the account's active team, the same as the switcher on the website. It runs in
  the main process (`workspaces.ts`, `workspaceMenu.ts`) through the existing session, so there is no new IPC call or
  preload function; the list is read at start, after sign-in or sign-out, and every five minutes.
  It also has What's New, Show Log File, Copy Diagnostics and (while signed in) Sign Out.
  If the desktop has no tray, creating it fails quietly and the app carries on without one.
- **Shortcut** (`shortcuts.ts`): `Ctrl/Cmd+Shift+Space` shows or hides the window from anywhere.
  Change `TOGGLE_WINDOW_SHORTCUT` to use another one. If another app already owns it, a warning is logged.
- "Check for Updates" in the menu or tray goes through the renderer (`menu:check-updates`), so you see the
  result in the update banner like a normal check.

## Settings window

The Settings window is the same renderer bundle loaded with the `#settings` hash (`main.tsx` picks
`SettingsWindow` instead of `App`), so it shares the theme, components and preload. It holds the update
channel, tray and launch-at-login options, update check, log file and what's new. Changes go through
`settings:update`, and `settingsEffects.ts` applies them (tray menu, channel re-check, login item) and
broadcasts `settings:changed` so every window and the tray stay in sync.
