import { useEffect } from 'react'
import { Button } from '@repo/ui'
import { FeedbackSection } from '@renderer/components/FeedbackSection'

/** The feedback form in a dialog, opened from the title bar. */
export function FeedbackDialog({
  signedIn,
  onClose
}: {
  signedIn: boolean
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
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
        aria-labelledby="feedback-title"
        className="flex max-h-full w-full max-w-sm flex-col rounded-lg border bg-card text-card-foreground shadow-lg"
      >
        <div className="border-b px-4 py-3">
          <h2 id="feedback-title" className="text-base font-semibold">
            Send feedback
          </h2>
          <p className="text-xs text-muted-foreground">Tell us what is broken or what you want.</p>
        </div>
        <div className="overflow-y-auto px-4 py-3">
          <FeedbackSection signedIn={signedIn} />
        </div>
        <div className="flex justify-end border-t px-4 py-2.5">
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
