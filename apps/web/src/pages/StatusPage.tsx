import { useEffect, useState, type JSX } from 'react'
import { Link } from 'react-router'
import { GITHUB_REPO } from '../config'
import { api } from '../lib/api'
import { fetchReleases, filterReleases, type Release } from '../lib/download'
import { ageText, expectedRollout } from '../lib/status'

interface State {
  releases: Release[] | null
  minimumVersion: string | null
  error: boolean
}

function Row({ title, release }: { title: string; release: Release | undefined }): JSX.Element {
  const rollout = release && !release.prerelease ? expectedRollout(release.published_at) : null
  return (
    <li className="space-y-1 px-4 py-3">
      <p className="font-medium">{title}</p>
      {release ? (
        <>
          <p className="text-sm">
            <a className="underline" href={release.html_url}>
              {release.tag_name}
            </a>{' '}
            <span className="text-muted-foreground">
              published {ageText(release.published_at) || 'recently'}
            </span>
          </p>
          <p className="text-sm text-muted-foreground">
            {release.prerelease
              ? 'Beta builds are offered to everyone on the beta channel right away.'
              : rollout === null
                ? 'Rollout stage unknown.'
                : rollout === 100
                  ? 'Offered to everyone.'
                  : `On the usual schedule this is offered to about ${rollout}% of people by now.`}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">No release yet.</p>
      )}
    </li>
  )
}

/** The newest versions and where they are in the staged rollout, from the same releases the download page uses. */
export function StatusPage(): JSX.Element {
  const [state, setState] = useState<State>({ releases: null, minimumVersion: null, error: false })

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      fetchReleases(GITHUB_REPO, controller.signal),
      // The minimum version is optional extra information: the page still works without it.
      api.appConfig().catch(() => ({ minimumVersion: null }))
    ])
      .then(([releases, config]) =>
        setState({ releases, minimumVersion: config.minimumVersion, error: false })
      )
      .catch((e: unknown) => {
        if (controller.signal.aborted) return
        console.error(e)
        setState((s) => ({ ...s, error: true }))
      })
    return () => controller.abort()
  }, [])

  const stable = state.releases ? filterReleases(state.releases, 'stable')[0] : undefined
  const beta = state.releases ? filterReleases(state.releases, 'beta')[0] : undefined

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Version status</h1>
        <p className="text-sm text-muted-foreground">
          The newest versions, and how far a new stable release has spread. See all of them in the{' '}
          <Link className="underline" to="/releases">
            release history
          </Link>
          .
        </p>
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          Could not load the releases. Try again in a minute.
        </p>
      )}
      {!state.releases && !state.error && <p className="text-muted-foreground">Loading...</p>}
      {state.releases && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          <Row title="Stable" release={stable} />
          <Row title="Beta" release={beta} />
          <li className="space-y-1 px-4 py-3">
            <p className="font-medium">Oldest supported version</p>
            <p className="text-sm text-muted-foreground">
              {state.minimumVersion
                ? `Versions older than ${state.minimumVersion} must be updated before they can be used.`
                : 'No limit. Every version still works.'}
            </p>
          </li>
        </ul>
      )}
    </div>
  )
}
