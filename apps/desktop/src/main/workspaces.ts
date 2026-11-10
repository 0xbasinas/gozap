import logger from 'electron-log/main'
import { accountAvailable, authCall, getAccount, onAccountChanged } from './auth'
import { parseWorkspaces, type WorkspaceState } from './workspaceMenu'

// The signed-in person's workspaces (their teams, plus Personal) and which one is active, for the tray menu.
// Everything runs in the main process through the same session as the rest of the account features; the page
// (renderer) is not involved and gets no new way to call the API.

const EMPTY: WorkspaceState = { teams: [], activeId: null }
const REFRESH_MS = 5 * 60_000

let state: WorkspaceState = EMPTY
const listeners = new Set<() => void>()

export const getWorkspaces = (): WorkspaceState => state

/** Run `listener` when the list of workspaces or the active one changes. */
export function onWorkspacesChanged(listener: () => void): void {
  listeners.add(listener)
}

function set(next: WorkspaceState): void {
  if (JSON.stringify(next) === JSON.stringify(state)) return
  state = next
  listeners.forEach((listener) => listener())
}

export async function refreshWorkspaces(): Promise<void> {
  if (!accountAvailable()) return
  try {
    if (!(await getAccount()).user) return set(EMPTY)
    const [teams, session] = await Promise.all([
      authCall('/organization/list'),
      authCall('/get-session')
    ])
    const active = (session as { session?: { activeOrganizationId?: unknown } } | null)?.session
      ?.activeOrganizationId
    set(parseWorkspaces(teams, active))
  } catch (error) {
    logger.warn('[workspaces] could not read the workspaces', error)
  }
}

/** Switch the session to a team, or to Personal (`null`), then re-read what the server now says. */
export async function switchWorkspace(teamId: string | null): Promise<void> {
  try {
    await authCall('/organization/set-active', { organizationId: teamId })
  } catch (error) {
    logger.warn('[workspaces] could not switch workspace', error)
  }
  await refreshWorkspaces()
}

/** Read the workspaces now, after every sign-in or sign-out, and every few minutes (teams change on other devices). */
export function startWorkspaceSync(): void {
  void refreshWorkspaces()
  onAccountChanged(() => void refreshWorkspaces())
  setInterval(() => void refreshWorkspaces(), REFRESH_MS).unref()
}
