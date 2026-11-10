// Pure helpers for the tray's "Workspace" menu: read what the API said (never trusted), and describe the menu items.
// No Electron import here, so it is unit tested (workspaceMenu.test.ts).

export interface WorkspaceTeam {
  id: string
  name: string
}
export interface WorkspaceState {
  teams: WorkspaceTeam[]
  /** The team the session works in, or null for Personal. */
  activeId: string | null
}

const MAX_TEAMS = 20
const MAX_NAME = 40

/** A team name made safe for a menu label: no control characters, one `&` becomes `&&` (a menu shortcut marker), short. */
export function menuLabel(name: string): string {
  const clean = Array.from(name, (ch) => {
    const code = ch.charCodeAt(0)
    return code < 32 || code === 127 ? ' ' : ch
  })
    .join('')
    .trim()
    .slice(0, MAX_NAME)
  return (clean || 'Untitled team').replaceAll('&', '&&')
}

/** Read the teams list and the session's active team from API answers. Anything unexpected becomes "no teams". */
export function parseWorkspaces(teams: unknown, activeId: unknown): WorkspaceState {
  const found: WorkspaceTeam[] = []
  if (Array.isArray(teams)) {
    for (const entry of teams.slice(0, MAX_TEAMS)) {
      if (typeof entry !== 'object' || entry === null) continue
      const { id, name } = entry as { id?: unknown; name?: unknown }
      if (typeof id === 'string' && id !== '' && id.length <= 64 && typeof name === 'string')
        found.push({ id, name })
    }
  }
  const active =
    typeof activeId === 'string' && found.some((t) => t.id === activeId) ? activeId : null
  return { teams: found, activeId: active }
}

export interface WorkspaceMenuItem {
  label: string
  type: 'radio'
  checked: boolean
  click: () => void
}

/** "Personal" plus one radio item per team, with the active one checked. `pick(null)` means Personal. */
export function workspaceMenuItems(
  state: WorkspaceState,
  pick: (teamId: string | null) => void
): WorkspaceMenuItem[] {
  return [
    { label: 'Personal', type: 'radio', checked: state.activeId === null, click: () => pick(null) },
    ...state.teams.map((team): WorkspaceMenuItem => ({
      label: menuLabel(team.name),
      type: 'radio',
      checked: state.activeId === team.id,
      click: () => pick(team.id)
    }))
  ]
}
