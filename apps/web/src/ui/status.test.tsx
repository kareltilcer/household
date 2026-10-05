// What says a state: the status and sync marks, banners, the offline bar, skeletons and the
// teaching empty state (02-components §0, §2 and §4.2).
import { statusGlyphs, type StatusId } from '@household/icons'
import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKey } from '../display/modes.ts'
import { draw, rootFollowsScale } from '../test/render.tsx'
import { Banner, OfflineBar, type BannerTone } from './Banner.tsx'
import { Button } from './Button.tsx'
import { EmptyState } from './EmptyState.tsx'
import { Skeleton } from './Skeleton.tsx'
import { StatusMark, SyncMark, syncStates } from './StatusMark.tsx'

const words = {
  row: 'Electricity advance',
  reason: 'That reading is lower than the one on 3 March.',
  readonly: 'Read-only',
  retry: 'Retry',
  sentence: 'No readings on this meter yet.',
  example: 'Petr reads the cellar meter on the first of each month.',
  add: 'Add a reading',
} as const

const statuses = Object.keys(statusGlyphs) as StatusId[]

describe('a status', () => {
  it.each(statuses)('is its colour token, its glyph and its word together: %s', (status) => {
    const { container } = draw(<StatusMark status={status} />)
    const mark = container.querySelector(`[data-status="${status}"]`)
    expect(mark?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    // The token is the status's own, whose pair on each ground is declared and tested.
    expect(mark?.querySelector('span')).toHaveStyle({
      color: `var(--${statusGlyphs[status].token})`,
    })
    expect(mark?.textContent.trim()).not.toBe('')
  })

  it('has thirteen states, each with a word of its own', () => {
    draw(
      <>
        {statuses.map((status) => (
          <StatusMark key={status} status={status} />
        ))}
      </>,
    )
    const said = statuses.map(
      (status) => document.querySelector(`[data-status="${status}"]`)?.textContent,
    )
    expect(new Set(said).size).toBe(13)
  })

  it('keeps its word for assistive technology where there is no room to draw it', () => {
    draw(<StatusMark status="rejected" words="hidden" />)
    const word = screen.getByText('Not accepted')
    expect(word.className).toContain('visuallyHidden')
  })

  it('says its word in the member’s language', () => {
    draw(<StatusMark status="pending" />, 'cs')
    expect(screen.getByText('Zatím neodesláno')).toBeInTheDocument()
  })
})

describe('the sync mark', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('has no synced state: a row in sync carries no mark', () => {
    expect(syncStates).toEqual(['pending', 'syncing', 'conflict', 'rejected'])
  })

  it('shows syncing only once it has taken longer than a moment', () => {
    vi.useFakeTimers()
    const { container, rerender } = draw(<SyncMark state="syncing" />)
    act(() => {
      vi.advanceTimersByTime(799)
    })
    expect(container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.getByText('Sending')).toBeInTheDocument()

    // A sync that finished in time was never shown, and one that starts again waits again.
    rerender(<SyncMark state="pending" />)
    rerender(<SyncMark state="syncing" />)
    expect(container.querySelector('[data-status="syncing"]')).toBeNull()
  })

  it('measures the moment from when the sync began, where it is told when', () => {
    vi.useFakeTimers()
    // A row drawn again in the middle of a long sync shows its mark at once: it waits no second
    // time.
    const { container, unmount } = draw(<SyncMark state="syncing" since={Date.now() - 5000} />)
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
    unmount()

    const later = draw(<SyncMark state="syncing" since={Date.now() - 300} />)
    act(() => {
      vi.advanceTimersByTime(499)
    })
    expect(later.container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(later.container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('stays shown when its owner learns when the write began, with no moment withdrawn', () => {
    vi.useFakeTimers()
    const { container, rerender } = draw(<SyncMark state="syncing" />)
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
    // No timer has run since: withdrawn and drawn again a moment later, it would be gone here,
    // and a table's column of marks with it.
    rerender(<SyncMark state="syncing" since={Date.now() - 800} />)
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
    rerender(<SyncMark state="syncing" />)
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('waits again when its owner says a write began just now', () => {
    vi.useFakeTimers()
    const { container, rerender } = draw(<SyncMark state="syncing" since={Date.now() - 5000} />)
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    rerender(<SyncMark state="syncing" since={Date.now()} />)
    expect(container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('draws at once the mark of a row that turns to a sync begun more than a moment ago', () => {
    vi.useFakeTimers()
    const { container, rerender } = draw(<SyncMark state="pending" />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    rerender(<SyncMark state="syncing" since={Date.now() - 1000} />)
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('draws at once in strict mode the mark of a sync that is already long', () => {
    vi.useFakeTimers()
    const { container } = draw(<SyncMark state="syncing" since={Date.now() - 5000} />, 'en', {
      strict: true,
    })
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('counts the moment from when it was drawn where the time it is told is no time', () => {
    vi.useFakeTimers()
    // What a date that does not parse comes to: no number is equal to it, itself included.
    const { container } = draw(<SyncMark state="syncing" since={Number.NaN} />)
    expect(container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(799)
    })
    expect(container.querySelector('[data-status]')).toBeNull()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(container.querySelector('[data-status="syncing"]')).not.toBeNull()
  })

  it('shows every other state at once', () => {
    draw(<SyncMark state="pending" />)
    expect(screen.getByText('Not sent yet')).toBeInTheDocument()
  })

  it.each(['pending', 'syncing'] as const)(
    'is words where there is nothing to open, whatever way it is given: %s',
    (state) => {
      vi.useFakeTimers()
      draw(<SyncMark state={state} onOpen={() => undefined} />)
      act(() => {
        vi.advanceTimersByTime(800)
      })
      expect(document.querySelector(`[data-status="${state}"]`)).not.toBeNull()
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
    },
  )

  it('is a control, named for what opening it does, where a state can be opened', async () => {
    const onOpen = vi.fn()
    draw(<SyncMark state="rejected" onOpen={onOpen} />)
    await userEvent.click(screen.getByRole('button', { name: 'Not accepted. Open for details' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('names the row whose two versions a conflict’s control opens', () => {
    draw(<SyncMark state="conflict" name={words.row} onOpen={() => undefined} />)
    expect(
      screen.getByRole('button', {
        name: 'Two versions of Electricity advance. Open to resolve',
      }),
    ).toBeInTheDocument()
  })
})

describe('a banner', () => {
  it.each<BannerTone>(['neutral', 'info', 'warning', 'danger'])(
    'says a %s state in a sentence, with a glyph that only repeats it',
    (tone) => {
      const { container } = draw(<Banner tone={tone}>{words.reason}</Banner>)
      expect(screen.getByText(words.reason)).toBeVisible()
      expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
      expect(container.firstElementChild?.className).toContain(tone)
      // One that was there when the screen opened is read in its place, and not announced.
      expect(container.firstElementChild).not.toHaveAttribute('role')
    },
  )

  it('carries its title and the actions that answer it', async () => {
    const onRetry = vi.fn()
    draw(
      <Banner
        tone="warning"
        title={words.readonly}
        actions={<Button onClick={onRetry}>{words.retry}</Button>}
      >
        {words.reason}
      </Banner>,
    )
    expect(screen.getByText(words.readonly)).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: words.retry }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('is announced when it arrives while the member is here: urgently only for a failure', async () => {
    const { unmount } = draw(
      <Banner tone="danger" announce>
        {words.reason}
      </Banner>,
    )
    // An alert is said as it arrives, words and all.
    expect(screen.getByRole('alert')).toHaveTextContent(words.reason)
    unmount()
    draw(
      <Banner tone="info" announce>
        {words.reason}
      </Banner>,
    )
    expect(await screen.findByText(words.reason)).toBeVisible()
    expect(screen.getByRole('status')).toHaveTextContent(words.reason)
  })

  it('is in the document before its words where it is announced politely, so that they are said', async () => {
    // What is put into a polite region already there is said; a region that arrives with its
    // words in it need not be.
    draw(
      <Banner
        tone="info"
        title={words.readonly}
        actions={<Button>{words.retry}</Button>}
        onDismiss={() => undefined}
        announce
      >
        {words.reason}
      </Banner>,
    )
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    await waitFor(() => {
      expect(region).toHaveTextContent(`${words.readonly}${words.reason}${words.retry}`)
    })
  })

  it('draws its words at once where nothing announces it', () => {
    const { container } = draw(<Banner tone="info">{words.reason}</Banner>)
    expect(container).toHaveTextContent(words.reason)
  })

  it('can be put away only where it is given a way', async () => {
    const onDismiss = vi.fn()
    const { rerender } = draw(<Banner tone="info">{words.reason}</Banner>)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    rerender(
      <Banner tone="info" onDismiss={onDismiss}>
        {words.reason}
      </Banner>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})

describe('the offline bar', () => {
  it('says the product’s own sentence, with the offline glyph beside it', async () => {
    const { container } = draw(<OfflineBar />)
    expect(await screen.findByText('Offline — changes are saved and will sync')).toBeVisible()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('is in the document before its sentence, so that it is said when the connection goes', async () => {
    draw(<OfflineBar />)
    const region = screen.getByRole('status')
    expect(region).toHaveTextContent('')
    await waitFor(() => {
      expect(region).toHaveTextContent('Offline — changes are saved and will sync')
    })
  })
})

describe('a skeleton', () => {
  it('says it is loading once, and draws the shape it was given', () => {
    const { container } = draw(
      <Skeleton
        bars={[
          [58, 1],
          [34, 0.8125],
        ]}
      />,
    )
    const skeleton = screen.getByRole('status', { name: 'Loading' })
    expect(skeleton).toHaveAttribute('aria-busy', 'true')
    expect(skeleton).toHaveTextContent('')
    const bars = [...container.querySelectorAll<HTMLElement>('[role="status"] > span')]
    expect(bars.map((bar) => [bar.style.inlineSize, bar.style.blockSize])).toEqual([
      ['58%', '1rem'],
      ['34%', '0.8125rem'],
    ])
  })
})

describe('the teaching empty state', () => {
  const empty = (
    <EmptyState
      sentence={words.sentence}
      example={words.example}
      action={<Button variant="primary">{words.add}</Button>}
      composition="utilities.not_enough"
    />
  )

  it('is one sentence, one example marked as one, and one action', () => {
    draw(empty)
    expect(screen.getByText(words.sentence)).toBeVisible()
    expect(screen.getByText('Example')).toBeVisible()
    expect(screen.getByText(words.example)).toBeVisible()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })

  it('draws its illustration as decoration at 100 % text', () => {
    rootFollowsScale()
    const { container } = draw(empty)
    expect(container.querySelector('svg[viewBox="0 0 200 140"]')).toHaveAttribute(
      'aria-hidden',
      'true',
    )
  })

  it('gives the illustration’s room to the sentence at 200 % text', () => {
    rootFollowsScale()
    window.localStorage.setItem(storageKey, JSON.stringify({ scale: '200' }))
    const { container } = draw(empty)
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText(words.sentence)).toBeVisible()
  })

  it('offers no action to a member who may not write, and frames no example it has none of', () => {
    draw(<EmptyState sentence={words.sentence} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Example')).not.toBeInTheDocument()
  })
})
