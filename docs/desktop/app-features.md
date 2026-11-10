# Built-in features

Diagnostics, notifications, logging and the first-run screen. Back to the [architecture overview](./architecture.md).

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
