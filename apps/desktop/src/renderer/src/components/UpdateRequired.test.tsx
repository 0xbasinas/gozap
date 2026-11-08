import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { UpdaterState } from '@renderer/hooks/useUpdater'
import { UpdateRequired } from './UpdateRequired'

afterEach(cleanup)

const updater = (patch: Partial<UpdaterState> = {}): UpdaterState => ({
  event: undefined,
  checking: false,
  check: vi.fn(),
  install: vi.fn(),
  dismiss: vi.fn(),
  ...patch
})

describe('UpdateRequired', () => {
  it('blocks, and starts the update when asked', () => {
    const state = updater()
    render(<UpdateRequired updater={state} />)
    expect(screen.getByRole('alertdialog', { name: 'Update required' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(state.check).toHaveBeenCalled()
  })

  it('shows progress, then offers the restart', () => {
    const { rerender } = render(
      <UpdateRequired updater={updater({ event: { type: 'progress', percent: 41.6 } })} />
    )
    expect(screen.getByRole('status').textContent).toBe('Downloading: 42%')

    const ready = updater({ event: { type: 'downloaded', version: '0.1.50' } })
    rerender(<UpdateRequired updater={ready} />)
    fireEvent.click(screen.getByRole('button', { name: 'Restart to update' }))
    expect(ready.install).toHaveBeenCalled()
  })
})
