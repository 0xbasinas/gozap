/** The GitHub repository whose releases the download page offers. `pnpm rename` updates it. */
export const GITHUB_REPO = '0xbasinas/gozap'
export const SITE_NAME = 'Gozap'
/** The desktop app's deep-link scheme (see PROTOCOL in apps/desktop/src/main/deeplink.ts). `pnpm rename` updates it. */
<<<<<<< ours
export const DESKTOP_SCHEME = 'gozap'
=======
export const DESKTOP_SCHEME = 'electron-desktop-template'

export interface Subprocessor {
  name: string
  purpose: string
  data: string
  region: string
}

/** Shown on /sub-processors. Edit this list to match the accounts you really use, and bump the date when it changes. */
export const SUBPROCESSORS_UPDATED = '2026-11-08'
export const SUBPROCESSORS: Subprocessor[] = [
  {
    name: 'Cloudflare',
    purpose: 'Hosts the website and API, and the database.',
    data: 'Email address, sign-in sessions, synced preferences.',
    region:
      'Cloudflare global network; the database lives in the region chosen when it was created.'
  },
  {
    name: 'Resend',
    purpose: 'Sends sign-in emails.',
    data: 'Email address, and whether a message was delivered.',
    region: 'The region chosen when the account was set up (United States or EU).'
  },
  {
    name: 'GitHub',
    purpose: 'Hosts the desktop app downloads and update files.',
    data: 'IP address and app version when the app checks for updates or you download it.',
    region: 'United States, through GitHub’s global network.'
  }
]
>>>>>>> theirs
