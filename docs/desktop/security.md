# Security model

How the app keeps the web page it shows from reaching the computer. Back to the [architecture overview](./architecture.md).

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

## The app:// scheme

In production the window loads `app://renderer/index.html`, not a `file://` URL. `apps/desktop/src/main/appProtocol.ts` registers the
scheme (before the app is ready; `standard` and `secure`, so it behaves like https for modules, storage and CORS) and
answers each request by reading the file from the built renderer folder inside `app.asar`. `resolveAppFile` in `appPath.ts`
maps the URL to a file and refuses anything that would leave that folder (`..`, encoded dots, sibling folders, NUL bytes);
it is unit tested. `isTrustedUrl` accepts only `app://renderer/` (or the dev server in development), so `secureIpc` rejects
every other page. This is what lets the `grantFileProtocolExtraPrivileges` fuse stay off. If you add a new asset type, add
its extension to the table in `appPath.ts`. The deep-link scheme (`PROTOCOL` in `deeplink.ts`) is a different thing.
