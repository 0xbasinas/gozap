import { useEffect, useState, type JSX } from 'react'
import { buttonVariants } from '@repo/ui'
import { Link } from 'react-router'
import { GITHUB_REPO } from '../config'
import {
  PLATFORM_LABEL,
  detectPlatform,
  fetchLatestRelease,
  formatSize,
  pickAsset,
  pickChecksums,
  type Platform,
  type Release
} from '../lib/download'

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; release: Release }

const PLATFORMS: Platform[] = ['windows', 'mac', 'linux']

export function DownloadPage(): JSX.Element {
  const [state, setState] = useState<State>({ status: 'loading' })
  const mine = detectPlatform(navigator.userAgent)

  useEffect(() => {
    const controller = new AbortController()
    fetchLatestRelease(GITHUB_REPO, controller.signal)
      .then((release) => setState({ status: 'ready', release }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          console.error(error)
          setState({ status: 'error' })
        }
      })
    return () => controller.abort()
  }, [])

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">Download</h1>
      {state.status === 'loading' && (
        <p className="text-muted-foreground">Looking up the latest version...</p>
      )}
      {state.status === 'error' && (
        <p className="text-muted-foreground">
          Could not load the latest version. See{' '}
          <a className="underline" href={`https://github.com/${GITHUB_REPO}/releases`}>
            all releases on GitHub
          </a>
          .
        </p>
      )}
      {state.status === 'ready' && (
        <>
          <p className="text-muted-foreground">Latest version: {state.release.tag_name}</p>
          <ul className="grid gap-4 sm:grid-cols-3">
            {PLATFORMS.map((platform) => {
              const asset = pickAsset(state.release.assets, platform)
              return (
                <li key={platform} className="rounded-lg border border-border p-5">
                  <h2 className="font-medium">{PLATFORM_LABEL[platform]}</h2>
                  {asset ? (
                    <a
                      className={
                        buttonVariants({ variant: platform === mine ? 'default' : 'outline' }) +
                        ' mt-4'
                      }
                      href={asset.browser_download_url}
                    >
                      Download{platform === mine ? ' (recommended)' : ''}
                    </a>
                  ) : (
                    <p className="mt-4 text-sm text-muted-foreground">Not available yet</p>
                  )}
                  {asset && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {asset.name} · {formatSize(asset.size)}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
          <Verify release={state.release} />
          <p className="text-sm text-muted-foreground">
            Looking for an older version or a beta? See the{' '}
            <Link className="underline" to="/releases">
              release history
            </Link>
            .
          </p>
        </>
      )}
    </div>
  )
}

/** How to check that a download is the file we published. */
function Verify({ release }: { release: Release }): JSX.Element {
  const sums = pickChecksums(release.assets)
  return (
    <section
      className="space-y-3 rounded-lg border border-border p-5"
      aria-label="Verify your download"
    >
      <h2 className="font-medium">Verify your download</h2>
      <p className="text-sm text-muted-foreground">
        Every release lists the SHA-256 of each installer
        {sums && (
          <>
            {' '}
            in{' '}
            <a className="underline" href={sums.browser_download_url}>
              SHA256SUMS.txt
            </a>
          </>
        )}
        . Compare it with the checksum of the file you downloaded:
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
        {
          'Windows (PowerShell): Get-FileHash .\\installer.exe -Algorithm SHA256\nmacOS or Linux: shasum -a 256 installer'
        }
      </pre>
      <p className="text-sm text-muted-foreground">
        Releases are also built with signed provenance, so you can check that a file came from this
        repository with{' '}
        <code className="text-xs">gh attestation verify installer --repo {GITHUB_REPO}</code>.
      </p>
    </section>
  )
}
