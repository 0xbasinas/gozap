import { Button } from '@repo/ui'
import type { UpdaterState } from '@renderer/hooks/useUpdater'

/** Slim banner under the title bar for update progress, "restart now" and check results. */
export function UpdateBanner({ updater }: { updater: UpdaterState }): React.JSX.Element | null {
  const { event, install, dismiss } = updater
  if (!event) return null

  let message: string
  let progress: number | undefined
  let actions: React.ReactNode = null

  switch (event.type) {
    case 'checking':
      message = 'Checking for updates...'
      break
    case 'available':
      message = `Downloading version ${event.version}...`
      progress = 0
      break
    case 'progress':
      message = `Downloading update: ${Math.round(event.percent)}%`
      progress = event.percent
      break
    case 'downloaded':
      message = `Version ${event.version} is ready to install.`
      actions = (
        <>
          <Button size="sm" variant="secondary" onClick={install}>
            Restart now
          </Button>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            Later
          </Button>
        </>
      )
      break
    case 'not-available':
      message = 'You are up to date.'
      break
    case 'error':
      message = `Could not check for updates: ${event.message}`
      break
  }

  return (
    <div
      role="status"
      className="fixed inset-x-0 top-10 z-40 border-b bg-primary text-primary-foreground"
    >
      <div className="flex min-h-10 items-center gap-3 px-4 text-sm">
        <span className="min-w-0 flex-1 truncate">{message}</span>
        {actions}
      </div>
      {progress !== undefined && (
        <div className="h-0.5 bg-primary-foreground/20">
          <div
            className="h-full bg-primary-foreground transition-[width]"
            style={{ width: `${Math.max(2, progress)}%` }}
          />
        </div>
      )}
    </div>
  )
}
