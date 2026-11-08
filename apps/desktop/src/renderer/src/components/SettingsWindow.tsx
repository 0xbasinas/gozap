import { useCallback, useEffect, useState } from 'react'
import type { AppInfo, Theme, UpdateChannel, UpdaterEvent, WhatsNew } from '../../../shared/ipc'
import { TitleBar } from '@renderer/components/TitleBar'
import { WhatsNewDialog } from '@renderer/components/WhatsNewDialog'
import { useAccount } from '@renderer/hooks/useAccount'
import { useSettings } from '@renderer/hooks/useSettings'
import { useUpdater } from '@renderer/hooks/useUpdater'
import { ACCENTS } from '@repo/shared/accents'
import { AccentPicker, Button, cn } from '@repo/ui'

const CHANNELS: { value: UpdateChannel; label: string; hint: string }[] = [
  { value: 'latest', label: 'Stable', hint: 'Tested releases. Recommended.' },
  { value: 'beta', label: 'Beta', hint: 'Early builds with new features, and the odd bug.' }
]

function updateText(event: UpdaterEvent | undefined, checking: boolean): string {
  if (checking && !event) return 'Checking for updates...'
  switch (event?.type) {
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return `Downloading version ${event.version}...`
    case 'progress':
      return `Downloading update: ${Math.round(event.percent)}%`
    case 'downloaded':
      return `Version ${event.version} is ready. Restart to install it.`
    case 'not-available':
      return 'You are up to date.'
    case 'error':
      return `Could not check for updates: ${event.message}`
    default:
      return ''
  }
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange
}: {
  label: string
  hint: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className={cn('flex items-start gap-3', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        className="mt-1"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{hint}</span>
      </span>
    </label>
  )
}

/** The settings window: update channel, tray and login behavior, and troubleshooting tools. */
export function SettingsWindow(): React.JSX.Element {
  const { settings, update } = useSettings()
  const updater = useUpdater()
  const { account, signIn, signOut } = useAccount()
  const [signingIn, setSigningIn] = useState(false)
  const [info, setInfo] = useState<AppInfo>()
  const [whatsNew, setWhatsNew] = useState<WhatsNew>()

  useEffect(() => {
    void window.api.getAppInfo().then(setInfo)
  }, [])

  const closeWhatsNew = useCallback(() => setWhatsNew(undefined), [])
  const platform = window.api.platform
  const status = updateText(updater.event, updater.checking)

  return (
    <>
      <TitleBar />
      <main className="mx-auto max-w-lg space-y-8 p-6 pt-16">
        {account?.available && (
          <Section title="Account">
            {account.user ? (
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  Signed in as <strong>{account.user.email}</strong>
                </span>
                <Button variant="outline" size="sm" onClick={() => void signOut()}>
                  Sign out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button
                  size="sm"
                  disabled={signingIn}
                  onClick={() => {
                    setSigningIn(true)
                    void signIn().finally(() => setSigningIn(false))
                  }}
                >
                  Sign in
                </Button>
                <span role="status" className="text-sm text-muted-foreground">
                  {signingIn
                    ? 'Finish signing in in your browser, then come back here.'
                    : 'Opens your browser. We email you a sign-in link.'}
                </span>
              </div>
            )}
          </Section>
        )}

        <Section title="Updates">
          <div role="radiogroup" aria-label="Update channel" className="grid grid-cols-2 gap-2">
            {CHANNELS.map((channel) => {
              const selected = settings?.updateChannel === channel.value
              return (
                <button
                  key={channel.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!settings}
                  onClick={() => update({ updateChannel: channel.value })}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors hover:bg-accent',
                    selected && 'border-primary bg-accent'
                  )}
                >
                  <span className="block text-sm font-medium">{channel.label}</span>
                  <span className="block text-xs text-muted-foreground">{channel.hint}</span>
                </button>
              )
            })}
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={updater.check} disabled={updater.checking}>
              Check for updates
            </Button>
            {updater.event?.type === 'downloaded' && (
              <Button size="sm" onClick={updater.install}>
                Restart now
              </Button>
            )}
            <span role="status" className="text-sm text-muted-foreground">
              {status}
            </span>
          </div>
        </Section>

        <Section title="General">
          <label className="flex items-center justify-between gap-3 text-sm">
            <span>
              Theme
              <span className="block text-xs text-muted-foreground">
                {account?.user
                  ? 'Synced with your other devices.'
                  : 'Sign in to use the same theme on every device.'}
              </span>
            </span>
            <select
              aria-label="Theme"
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
              value={settings?.theme ?? 'system'}
              disabled={!settings}
              onChange={(event) => update({ theme: event.target.value as Theme })}
            >
              <option value="system">Match my system</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span>
              Accent colour
              <span className="block text-xs text-muted-foreground">
                {account?.user
                  ? 'Synced with your other devices.'
                  : 'Sign in to use it on every device.'}
              </span>
            </span>
            <AccentPicker
              accents={ACCENTS}
              value={settings?.accent}
              disabled={!settings}
              label="Accent colour"
              onChange={(accent) => void update({ accent })}
            />
          </div>
          {platform !== 'darwin' && (
            <Toggle
              label="Keep running in the tray when closed"
              hint="Closing the window hides it instead of quitting. Quit from the tray menu."
              checked={settings?.closeToTray ?? false}
              disabled={!settings}
              onChange={(closeToTray) => update({ closeToTray })}
            />
          )}
          {platform !== 'linux' && (
            <Toggle
              label="Launch at login"
              hint={
                info && !info.isPackaged
                  ? 'Only available in installed builds.'
                  : 'Start the app when you sign in.'
              }
              checked={settings?.launchAtLogin ?? false}
              disabled={!settings || (info !== undefined && !info.isPackaged)}
              onChange={(launchAtLogin) => update({ launchAtLogin })}
            />
          )}
          {info?.crashReportingAvailable && (
            <Toggle
              label="Send anonymous crash reports"
              hint="Helps fix crashes faster. Includes the app version, never your name or IP address. Applies after a restart."
              checked={settings?.crashReports ?? false}
              disabled={!settings}
              onChange={(crashReports) => update({ crashReports })}
            />
          )}
        </Section>

        <Section title="About and troubleshooting">
          <p className="text-sm text-muted-foreground">
            {info ? `Version ${info.version}` : 'Version'} · Electron {window.api.versions.electron}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => window.api.openLogs()}>
              Show log file
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void window.api.getWhatsNew(true).then(setWhatsNew)}
            >
              What&apos;s new
            </Button>
          </div>
        </Section>
      </main>
      {whatsNew && <WhatsNewDialog data={whatsNew} onClose={closeWhatsNew} />}
    </>
  )
}
