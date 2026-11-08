import { useEffect, useState, type JSX } from 'react'
import { cn } from '@repo/ui'
import { GITHUB_REPO } from '../config'
import {
  fetchReleases,
  filterReleases,
  formatSize,
  pickChecksums,
  type Release
} from '../lib/download'

type Channel = 'stable' | 'beta' | 'all'
type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; releases: Release[] }

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'stable', label: 'Stable' },
  { value: 'beta', label: 'Beta' },
  { value: 'all', label: 'All' }
]

const date = (iso: string): string => (iso ? new Date(iso).toLocaleDateString() : '')

export function ReleasesPage(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [channel, setChannel] = useState<Channel>('stable')

  useEffect(() => {
    const controller = new AbortController()
    fetchReleases(GITHUB_REPO, controller.signal)
      .then((releases) => setState({ status: 'ready', releases }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error)
          setState({ status: 'error' })
        }
      })
    return () => controller.abort()
  }, [])

  const shown = state.status === 'ready' ? filterReleases(state.releases, channel) : []

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Release history</h1>
      <div role="group" aria-label="Release channel" className="flex gap-2">
        {CHANNELS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-pressed={channel === c.value}
            onClick={() => setChannel(c.value)}
            className={cn(
              'rounded-md border px-3 py-1 text-sm',
              channel === c.value ? 'border-primary bg-accent' : 'text-muted-foreground'
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      {state.status === 'loading' && <p className="text-muted-foreground">Loading releases...</p>}
      {state.status === 'error' && (
        <p role="alert" className="text-muted-foreground">
          Could not load the releases. See{' '}
          <a className="underline" href={`https://github.com/${GITHUB_REPO}/releases`}>
            all releases on GitHub
          </a>
          .
        </p>
      )}
      {state.status === 'ready' && shown.length === 0 && (
        <p className="text-muted-foreground">No releases here yet.</p>
      )}
      <ul className="space-y-3">
        {shown.map((release) => {
          const sums = pickChecksums(release.assets)
          return (
            <li key={release.tag_name} className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-medium">
                  {release.tag_name}
                  {release.prerelease && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">beta</span>
                  )}
                </h2>
                <span className="text-xs text-muted-foreground">{date(release.published_at)}</span>
              </div>
              <p className="mt-2 text-sm">
                <a className="underline" href={release.html_url}>
                  Release notes
                </a>
                {sums && (
                  <>
                    {' · '}
                    <a className="underline" href={sums.browser_download_url}>
                      Checksums
                    </a>
                  </>
                )}
              </p>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {release.assets
                  .filter((a) => /\.(exe|dmg|AppImage)$/i.test(a.name))
                  .map((a) => (
                    <li key={a.name}>
                      <a className="underline" href={a.browser_download_url}>
                        {a.name}
                      </a>{' '}
                      ({formatSize(a.size)})
                    </li>
                  ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
