import { describe, expect, it, vi } from 'vitest'
import { menuLabel, parseWorkspaces, workspaceMenuItems } from './workspaceMenu'

describe('parseWorkspaces', () => {
  it('reads teams and the active one', () => {
    const state = parseWorkspaces(
      [
        { id: 't1', name: 'Acme', slug: 'acme' },
        { id: 't2', name: 'Beta' }
      ],
      't2'
    )
    expect(state).toEqual({
      teams: [
        { id: 't1', name: 'Acme' },
        { id: 't2', name: 'Beta' }
      ],
      activeId: 't2'
    })
  })

  it('ignores anything unexpected', () => {
    expect(parseWorkspaces(null, null)).toEqual({ teams: [], activeId: null })
    expect(parseWorkspaces('nope', 5)).toEqual({ teams: [], activeId: null })
    const state = parseWorkspaces(
      [null, 3, { id: 7, name: 'x' }, { id: '', name: 'x' }, { id: 'ok', name: 'Ok' }],
      'missing'
    )
    // An active team that is not in the list means Personal.
    expect(state).toEqual({ teams: [{ id: 'ok', name: 'Ok' }], activeId: null })
  })

  it('keeps at most 20 teams', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, name: `T${i}` }))
    expect(parseWorkspaces(many, null).teams).toHaveLength(20)
  })
})

describe('menuLabel', () => {
  it('escapes ampersands, removes control characters and shortens', () => {
    expect(menuLabel('R&D')).toBe('R&&D')
    expect(menuLabel('a\nb\u0000c')).toBe('a b c')
    expect(menuLabel('x'.repeat(100))).toHaveLength(40)
    expect(menuLabel('   ')).toBe('Untitled team')
  })
})

describe('workspaceMenuItems', () => {
  it('lists Personal first, checks the active one and reports the pick', () => {
    const pick = vi.fn()
    const items = workspaceMenuItems({ teams: [{ id: 't1', name: 'Acme' }], activeId: 't1' }, pick)
    expect(items.map((i) => [i.label, i.checked])).toEqual([
      ['Personal', false],
      ['Acme', true]
    ])
    items[0]!.click()
    items[1]!.click()
    expect(pick.mock.calls).toEqual([[null], ['t1']])
  })

  it('checks Personal when no team is active', () => {
    const items = workspaceMenuItems(
      { teams: [{ id: 't1', name: 'Acme' }], activeId: null },
      vi.fn()
    )
    expect(items[0]!.checked).toBe(true)
  })
})
