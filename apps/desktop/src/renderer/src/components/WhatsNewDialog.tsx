import { useEffect, useRef } from 'react'
import type { WhatsNew } from '../../../shared/ipc'
import { Button } from '@repo/ui'
import { Markdown } from '@renderer/components/Markdown'

/** Welcome screen on first run, and release notes after an update. */
export function WhatsNewDialog({
  data,
  onClose
}: {
  data: WhatsNew
  onClose: () => void
}): React.JSX.Element {
  const button = useRef<HTMLButtonElement>(null)
  const firstRun = data.kind === 'first-run'

  useEffect(() => {
    button.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 pt-14">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        className="flex max-h-full w-full max-w-sm flex-col rounded-lg border bg-card text-card-foreground shadow-lg"
      >
        <div className="border-b px-4 py-3">
          <h2 id="whats-new-title" className="text-base font-semibold">
            {firstRun ? `Welcome to ${document.title}` : `What's new in ${data.version}`}
          </h2>
          <p className="text-xs text-muted-foreground">
            {firstRun ? `Version ${data.version}` : 'Here is what changed since your last version.'}
          </p>
        </div>
        <div className="overflow-y-auto px-4 py-3 text-sm [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-sm">
          <Markdown source={data.notes} />
        </div>
        <div className="flex justify-end border-t px-4 py-2.5">
          <Button ref={button} size="sm" onClick={onClose}>
            {firstRun ? 'Get started' : 'Got it'}
          </Button>
        </div>
      </div>
    </div>
  )
}
