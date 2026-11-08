import { Button } from '@repo/ui'
import type { UpdaterState } from '@renderer/hooks/useUpdater'

/** A blocking screen: this version is too old (for example it has a security problem), so it asks for an update. */
export function UpdateRequired({ updater }: { updater: UpdaterState }): React.JSX.Element {
  const { event, check, install, checking } = updater
  const downloaded = event?.type === 'downloaded'
  const progress =
    event?.type === 'progress'
      ? `Downloading: ${Math.round(event.percent)}%`
      : event?.type === 'available'
        ? `Downloading version ${event.version}...`
        : event?.type === 'error'
          ? `Could not update: ${event.message}`
          : event?.type === 'not-available'
            ? 'No update was found yet. Try again in a few minutes.'
            : null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-background p-6"
    >
      <div className="max-w-sm space-y-3 text-center">
        <h2 id="update-required-title" className="text-xl font-semibold">
          Update required
        </h2>
        <p className="text-sm text-muted-foreground">
          This version is no longer supported. Update to keep using the app.
        </p>
        {progress && (
          <p role="status" className="text-sm">
            {progress}
          </p>
        )}
        <Button disabled={checking && !downloaded} onClick={downloaded ? install : check}>
          {downloaded ? 'Restart to update' : 'Update now'}
        </Button>
      </div>
    </div>
  )
}
