// Hold-to-complete (02-components §4.1), ported from `home`'s tests of the same gesture and held
// to its two non-negotiables: progress shown for the whole 2000 ms, and an immediate path for the
// keyboard and for assistive technology.
import { act, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../display/modes.ts'
import { draw } from '../test/render.tsx'
import { HoldToComplete } from './HoldToComplete.tsx'

const label = 'Complete Take out the bins'

function Hold({ onComplete }: { onComplete: () => unknown }) {
  return <HoldToComplete label={label} onComplete={onComplete} />
}

/** The ring a pointer holds, and the fill that shows how far the hold has come. */
function ring(): HTMLElement {
  const target = screen.getByRole('button', { name: label }).previousElementSibling
  if (!(target instanceof HTMLElement)) throw new Error('the control has no ring')
  return target
}

function phase(): string | null {
  return ring().parentElement?.getAttribute('data-phase') ?? null
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('holding', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('completes after the whole 2000 ms, and not a moment before', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring())
    expect(phase()).toBe('holding')
    advance(1999)
    expect(onComplete).not.toHaveBeenCalled()
    advance(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
    expect(screen.getByRole('status')).toHaveTextContent('Completed')
  })

  it('does not complete on a short press, says to keep holding, and is then as it was', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring())
    advance(500)
    fireEvent.pointerUp(ring())
    expect(phase()).toBe('released')
    expect(screen.getByRole('status')).toHaveTextContent('Keep holding to complete')
    // The word stays as long as a toast would, and no longer: a row touched once is not left
    // saying it (02-components §4.1: released early, it returns to idle).
    advance(4999)
    expect(phase()).toBe('released')
    advance(1)
    expect(phase()).toBe('idle')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('completes with what its owner asks at the end of the hold, not at its start', () => {
    const stale = vi.fn()
    const current = vi.fn()
    const { rerender } = draw(<Hold onComplete={stale} />)
    fireEvent.pointerDown(ring())
    advance(1000)
    // The row was drawn again under the hold: a sync brought it a newer version to complete.
    rerender(<Hold onComplete={current} />)
    expect(phase()).toBe('holding')
    advance(1000)
    expect(current).toHaveBeenCalledTimes(1)
    expect(stale).not.toHaveBeenCalled()
  })

  it.each(['pointerLeave', 'pointerCancel'] as const)(
    'gives the hold up when the pointer goes: %s',
    (gone) => {
      const onComplete = vi.fn()
      draw(<Hold onComplete={onComplete} />)
      fireEvent.pointerDown(ring())
      advance(1000)
      fireEvent[gone](ring())
      advance(5000)
      expect(onComplete).not.toHaveBeenCalled()
    },
  )

  it('starts over on a second hold: time held before does not count', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring())
    advance(1500)
    fireEvent.pointerUp(ring())
    fireEvent.pointerDown(ring())
    advance(1999)
    expect(onComplete).not.toHaveBeenCalled()
    advance(1)
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('is not taken back to idle under a second hold by the word of the first', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring())
    advance(500)
    fireEvent.pointerUp(ring())
    // Held again just before the first release's word would have gone.
    advance(4500)
    fireEvent.pointerDown(ring())
    advance(1000)
    expect(phase()).toBe('holding')
    advance(1000)
    expect(onComplete).toHaveBeenCalledTimes(1)
    expect(phase()).toBe('completed')
  })

  it('is held by the primary button alone', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring(), { button: 2 })
    advance(3000)
    expect(onComplete).not.toHaveBeenCalled()
    expect(phase()).toBe('idle')
  })

  it('never reaches the row it sits in: not the press, not the tap, not the menu', () => {
    const onRow = vi.fn()
    const { container } = draw(
      // The row is whatever holds the control, and opens on a press.
      <div onClick={onRow} onPointerDown={onRow}>
        <Hold onComplete={() => undefined} />
      </div>,
    )
    fireEvent.pointerDown(ring())
    fireEvent.pointerUp(ring())
    fireEvent.click(ring())
    expect(onRow).not.toHaveBeenCalled()
    expect(fireEvent.contextMenu(ring())).toBe(false)
    expect(container).toBeInTheDocument()
  })

  it('takes no second completion once it has completed', () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    fireEvent.pointerDown(ring())
    advance(2000)
    fireEvent.pointerDown(ring())
    advance(2000)
    fireEvent.click(screen.getByRole('button', { name: label }))
    expect(onComplete).toHaveBeenCalledTimes(1)
  })
})

describe('the keyboard and assistive technology', () => {
  it('meet a plain button, named for what it completes, that completes at once', async () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    await userEvent.tab()
    expect(screen.getByRole('button', { name: label })).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('complete on Space as on Enter, and on a screen reader’s activation', async () => {
    const onComplete = vi.fn()
    draw(<Hold onComplete={onComplete} />)
    await userEvent.tab()
    await userEvent.keyboard(' ')
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('are not shown the ring, which is a pointer’s alone', () => {
    draw(<Hold onComplete={() => undefined} />)
    expect(ring()).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})

describe('a completion that takes a while', () => {
  it('says it is completing, then that it completed', async () => {
    let finish: () => void = () => undefined
    const onComplete = () =>
      new Promise<void>((resolve) => {
        finish = resolve
      })
    draw(<Hold onComplete={onComplete} />)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(phase()).toBe('completing')
    expect(screen.getByRole('status')).toHaveTextContent('Completing')
    await act(async () => {
      finish()
      await Promise.resolve()
    })
    expect(phase()).toBe('completed')
  })

  it('says so when it fails, in words, and can be tried again', async () => {
    const onComplete = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce()
    draw(<Hold onComplete={onComplete} />)
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByText('Not completed. Try again')).toBeVisible()
    expect(phase()).toBe('failed')
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(await screen.findByText('Completed')).toBeVisible()
    expect(onComplete).toHaveBeenCalledTimes(2)
  })

  it('says a completion that threw failed, as one that was refused did', async () => {
    draw(
      <Hold
        onComplete={() => {
          throw new Error('refused')
        }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: label }))
    expect(phase()).toBe('failed')
  })
})

describe('the progress', () => {
  /** The fill, as the stylesheet times it. */
  function fill(): SVGElement {
    const circle = ring().querySelectorAll('circle')[1]
    if (circle === undefined) throw new Error('the ring has no fill')
    return circle
  }

  it('is a sweep for the whole hold, timed by the stylesheet', () => {
    draw(<Hold onComplete={() => undefined} />)
    expect(fill().style.animationTimingFunction).toBe('')
  })

  it('is ten steps, and not a sweep, when the member asks for reduced motion', () => {
    window.localStorage.setItem(storageKey, JSON.stringify({ motion: 'reduced' }))
    draw(<Hold onComplete={() => undefined} />)
    expect(fill().style.animationTimingFunction).toBe('steps(10, end)')
  })

  it('is ten steps when the device asks for reduced motion', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }))
    draw(<Hold onComplete={() => undefined} />)
    expect(fill().style.animationTimingFunction).toBe('steps(10, end)')
  })
})
