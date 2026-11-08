export type Platform = 'windows' | 'mac' | 'linux'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface Release {
  tag_name: string
  html_url: string
  assets: ReleaseAsset[]
  /** Beta builds are published as pre-releases. */
  prerelease: boolean
  /** ISO date, or "" if GitHub did not say. */
  published_at: string
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux'
}

/** Best guess at the visitor OS from the user agent; null for phones and unknown systems. */
export function detectPlatform(userAgent: string): Platform | null {
  if (/android|iphone|ipad|ipod/i.test(userAgent)) return null
  if (/windows/i.test(userAgent)) return 'windows'
  if (/macintosh|mac os x/i.test(userAgent)) return 'mac'
  if (/linux|x11|cros/i.test(userAgent)) return 'linux'
  return null
}

const INSTALLER: Record<Platform, RegExp> = {
  windows: /\.exe$/i,
  mac: /\.dmg$/i,
  linux: /\.AppImage$/i
}

/** The installer to offer for a platform (not blockmaps, update manifests or checksums). */
export function pickAsset(assets: ReleaseAsset[], platform: Platform): ReleaseAsset | null {
  return assets.find((a) => INSTALLER[platform].test(a.name)) ?? null
}

/** Checks the shape of the GitHub API response so a surprise payload cannot break the page. */
export function parseRelease(data: unknown): Release | null {
  if (typeof data !== 'object' || data === null) return null
  const r = data as Record<string, unknown>
  if (typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || !Array.isArray(r.assets))
    return null
  const assets: ReleaseAsset[] = []
  for (const a of r.assets) {
    if (typeof a !== 'object' || a === null) continue
    const x = a as Record<string, unknown>
    if (
      typeof x.name === 'string' &&
      typeof x.browser_download_url === 'string' &&
      typeof x.size === 'number' &&
      x.browser_download_url.startsWith('https://')
    )
      assets.push({ name: x.name, browser_download_url: x.browser_download_url, size: x.size })
  }
  return {
    tag_name: r.tag_name,
    html_url: r.html_url,
    assets,
    prerelease: r.prerelease === true,
    published_at: typeof r.published_at === 'string' ? r.published_at : ''
  }
}

/** The file with the SHA-256 of every installer, which releases publish next to them. */
export function pickChecksums(assets: ReleaseAsset[]): ReleaseAsset | null {
  return assets.find((a) => a.name === 'SHA256SUMS.txt') ?? null
}

/** "84.2 MB" style size for a download button. */
export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Stable releases or beta ones (pre-releases), newest first as GitHub returns them. */
export function filterReleases(releases: Release[], channel: 'stable' | 'beta' | 'all'): Release[] {
  if (channel === 'all') return releases
  return releases.filter((r) => r.prerelease === (channel === 'beta'))
}

/** Parses a list of releases, dropping entries with a surprise shape. */
export function parseReleases(data: unknown): Release[] {
  if (!Array.isArray(data)) return []
  return data.flatMap((item) => {
    const release = parseRelease(item)
    return release ? [release] : []
  })
}

export async function fetchLatestRelease(repo: string, signal?: AbortSignal): Promise<Release> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  const release = parseRelease(await res.json())
  if (!release) throw new Error('Unexpected release data')
  return release
}

export async function fetchReleases(repo: string, signal?: AbortSignal): Promise<Release[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=30`, {
    headers: { Accept: 'application/vnd.github+json' },
    signal
  })
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`)
  return parseReleases(await res.json())
}
