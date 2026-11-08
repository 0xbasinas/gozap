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
        className="flex max-h-full w-full max-w-lg flex-col rounded-xl border bg-card text-card-foreground shadow-lg"
      >
        <div className="border-b p-5">
          <h2 id="whats-new-title" className="text-lg font-semibold">
            {firstRun ? `Welcome to ${document.title}` : `What's new in ${data.version}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            {firstRun ? `Version ${data.version}` : 'Here is what changed since your last version.'}
          </p>
        </div>
        <div className="overflow-y-auto p-5">
          <Markdown source={data.notes} />
        </div>
        <div className="flex justify-end border-t p-4">
          <Button ref={button} onClick={onClose}>
            {firstRun ? 'Get started' : 'Got it'}
          </Button>
        </div>
      </div>
    </div>
  )
}
